import type { Prisma } from "@/generated/prisma/client";
import { parseISODate, addDays } from "@/lib/accounting/dates";
import { calendarYearOf } from "@/lib/accounting/fiscal";
import { BUSINESS_CHART, DEFAULT_DIMENSIONS, DEFAULT_NUMBER_SERIES, VAT_TEMPLATES } from "@/lib/accounting/templates";
import { ensureDefaultAssetGroups } from "./assets";

type Tx = Prisma.TransactionClient;

export type SetupResult = {
  accounts: number;
  vatRates: number;
  fiscalYears: number;
  numberSeries: number;
  dimensions: number;
};

/**
 * Loob ettevõttele puuduvad vaikeseadistused: kontoplaan, käibemaksud, majandusaasta,
 * numbriseeriad ja dimensioonid. Iga osa luuakse ainult siis, kui see on tühi – seega on
 * funktsioon korduvkäivitamisel ohutu ja sobib ka olemasolevate ettevõtete täiendamiseks.
 */
export async function ensureCompanyDefaults(
  tx: Tx,
  companyId: string,
  opts: { userId: string | null; startDate?: Date },
): Promise<SetupResult> {
  const result: SetupResult = { accounts: 0, vatRates: 0, fiscalYears: 0, numberSeries: 0, dimensions: 0 };
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
  const startDate = company.accountingStartDate ?? opts.startDate ?? calendarYearOf(new Date()).startDate;
  if (!company.accountingStartDate) {
    await tx.company.update({ where: { id: companyId }, data: { accountingStartDate: startDate } });
  }

  // Kontoplaan
  if ((await tx.glAccount.count({ where: { companyId } })) === 0) {
    await tx.glAccount.createMany({
      data: BUSINESS_CHART.map((a) => ({
        companyId,
        code: a.code,
        name: a.name,
        nameEn: a.nameEn,
        type: a.type,
        reportLine: a.reportLine,
        role: a.role ?? null,
        vatTurnover: a.vatTurnover ?? "NONE",
        isPaymentMethod: a.isPaymentMethod ?? false,
        createdById: opts.userId,
      })),
    });
    result.accounts = BUSINESS_CHART.length;
  }

  // Käibemaksud
  if ((await tx.vatRate.count({ where: { companyId } })) === 0) {
    const accounts = await tx.glAccount.findMany({ where: { companyId }, select: { id: true, code: true } });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const [index, v] of VAT_TEMPLATES.entries()) {
      const rate = await tx.vatRate.create({
        data: {
          companyId,
          code: v.code,
          name: v.name,
          nameEn: v.nameEn,
          kind: v.kind,
          deductiblePct: v.deductiblePct ?? 100,
          invoiceNote: v.invoiceNote ?? null,
          salesAccountId: v.salesAccount ? (byCode.get(v.salesAccount) ?? null) : null,
          purchaseAccountId: v.purchaseAccount ? (byCode.get(v.purchaseAccount) ?? null) : null,
          sortOrder: index,
          createdById: opts.userId,
        },
      });
      await tx.vatRatePeriod.createMany({
        data: v.periods.map((p) => ({
          companyId,
          vatRateId: rate.id,
          rate: p.rate,
          validFrom: parseISODate(p.validFrom)!,
          validTo: p.validTo ? parseISODate(p.validTo)! : null,
        })),
      });
    }
    // Kontode vaikimisi käibemaksud
    const rates = await tx.vatRate.findMany({ where: { companyId }, select: { id: true, code: true } });
    const rateByCode = new Map(rates.map((r) => [r.code, r.id]));
    const codesByVat = new Map<string, string[]>();
    for (const a of BUSINESS_CHART) if (a.vat) codesByVat.set(a.vat, [...(codesByVat.get(a.vat) ?? []), a.code]);
    for (const [vatCode, codes] of codesByVat) {
      const vatId = rateByCode.get(vatCode);
      if (vatId) {
        await tx.glAccount.updateMany({ where: { companyId, code: { in: codes } }, data: { defaultVatRateId: vatId } });
      }
    }
    result.vatRates = VAT_TEMPLATES.length;
  }

  // Majandusaasta: kalendriaasta, mis sisaldab arvestuse alguse kuupäeva
  if ((await tx.fiscalYear.count({ where: { companyId } })) === 0) {
    const year = calendarYearOf(startDate);
    await tx.fiscalYear.create({ data: { companyId, ...year, createdById: opts.userId } });
    result.fiscalYears = 1;
  }

  // Numbriseeriad (iga dokumenditüübi kohta, mis puudub)
  const existingSeries = new Set(
    (await tx.numberSeries.findMany({ where: { companyId }, select: { documentType: true } })).map((s) => s.documentType),
  );
  const missing = DEFAULT_NUMBER_SERIES.filter((s) => !existingSeries.has(s.documentType));
  if (missing.length) {
    await tx.numberSeries.createMany({ data: missing.map((s) => ({ companyId, ...s, createdById: opts.userId })) });
    result.numberSeries = missing.length;
  }

  // Pangakonto ja kassa
  if ((await tx.bankAccount.count({ where: { companyId } })) === 0) {
    const money = await tx.glAccount.findMany({ where: { companyId, code: { in: ["1020", "1000"] } }, select: { id: true, code: true } });
    const byCode = new Map(money.map((a) => [a.code, a.id]));
    const defaults = [
      { kind: "BANK" as const, name: "Pangakonto", code: "1020", sortOrder: 0 },
      { kind: "CASH" as const, name: "Kassa", code: "1000", sortOrder: 1 },
    ];
    for (const d of defaults) {
      const accountId = byCode.get(d.code);
      if (!accountId) continue;
      await tx.bankAccount.create({
        data: { companyId, kind: d.kind, name: d.name, accountId, currency: company.baseCurrency, showOnInvoice: d.kind === "BANK", sortOrder: d.sortOrder, createdById: opts.userId },
      });
    }
  }

  // Põhivara grupid
  await ensureDefaultAssetGroups(tx, companyId, opts.userId);

  // Dimensioonid
  if ((await tx.dimension.count({ where: { companyId } })) === 0) {
    await tx.dimension.createMany({
      data: DEFAULT_DIMENSIONS.map((d, i) => ({ companyId, ...d, sortOrder: i, createdById: opts.userId })),
    });
    result.dimensions = DEFAULT_DIMENSIONS.length;
  }

  return result;
}

/** Algsaldode kuupäev: arvestuse algusele eelnev päev. */
export function openingBalanceDate(accountingStartDate: Date): Date {
  return addDays(accountingStartDate, -1);
}

/** Kas ettevõttel on raamatupidamise põhiseadistus olemas. */
export async function isCompanySetUp(tx: Tx, companyId: string): Promise<boolean> {
  return (await tx.glAccount.count({ where: { companyId } })) > 0;
}
