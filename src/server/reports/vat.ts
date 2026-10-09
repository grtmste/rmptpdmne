import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { resolveVatRate } from "@/lib/accounting/vat";
import { toBase } from "@/lib/sales/calc";
import { computeKmd, computeKmdInf, sideOf, type KmdInfDocument, type KmdSourceLine, type VatKind } from "@/lib/vat/kmd";

/**
 * KMD ja KMD INF arvestus kuu kohta pearaamatu kannetest. KMD sulgemiskanded (VAT_CLOSING)
 * ei kajastu – need ainult kannavad KM kontode saldod käibemaksu arveldusse.
 */

type Tx = Prisma.TransactionClient;

const FIXED_ASSET_LINES = new Set(["BS_PPE", "BS_INTANGIBLES", "BS_INVESTMENT_PROPERTY", "BS_LT_BIOLOGICAL"]);

export function monthPeriod(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from, to };
}

/** KM kontod (arvestatud ja sisend) kõigilt KM koodidelt. */
export async function vatAccounts(tx: Tx, companyId: string) {
  const rates = await tx.vatRate.findMany({ where: { companyId }, select: { salesAccountId: true, purchaseAccountId: true } });
  const output = new Set(rates.flatMap((r) => (r.salesAccountId ? [r.salesAccountId] : [])));
  const input = new Set(rates.flatMap((r) => (r.purchaseAccountId ? [r.purchaseAccountId] : [])));
  return { output, input };
}

export async function vatReturn(
  tx: Tx,
  companyId: string,
  opts: { year: number; month: number; adjustmentsPlus?: string | null; adjustmentsMinus?: string | null },
) {
  const { from, to } = monthPeriod(opts.year, opts.month);
  const entryWhere = { status: "POSTED" as const, date: { gte: from, lte: to }, source: { not: "VAT_CLOSING" as const } };

  const rows = await tx.journalLine.findMany({
    where: { companyId, vatRateId: { not: null }, vatAmount: { not: null }, entry: entryWhere },
    select: {
      debit: true,
      credit: true,
      vatAmount: true,
      entry: { select: { id: true, date: true, source: true, sourceId: true } },
      account: { select: { type: true, vatTurnover: true, reportLine: true } },
      vatRate: { select: { kind: true, deductiblePct: true, periods: true } },
    },
  });
  const standard = await tx.vatRate.findFirst({
    where: { companyId, kind: "TAXABLE", deductiblePct: 100 },
    orderBy: { sortOrder: "asc" },
    include: { periods: true },
  });

  const lines: Array<KmdSourceLine & { documentId: string | null }> = rows.map((r) => {
    const date = r.entry.date;
    const docSource = r.entry.source === "SALES_INVOICE" || r.entry.source === "PURCHASE_INVOICE";
    return {
      entryId: r.entry.id,
      source: r.entry.source,
      sourceId: r.entry.sourceId,
      side: sideOf(r.entry.source, r.account.vatTurnover, r.account.type),
      kind: r.vatRate!.kind as VatKind,
      ratePct: resolveVatRate(r.vatRate!.periods, date) ?? dec(0),
      standardPct: (standard && resolveVatRate(standard.periods, date)) ?? dec(0),
      deductiblePct: dec(r.vatRate!.deductiblePct),
      debit: dec(r.debit),
      credit: dec(r.credit),
      vatAmount: dec(r.vatAmount!),
      fixedAsset: r.account.type === "ASSET" && FIXED_ASSET_LINES.has(r.account.reportLine ?? ""),
      documentId: docSource ? r.entry.sourceId : null,
    };
  });

  // Rida 5: sisendkäibemaksu kontode käive perioodis
  const { input } = await vatAccounts(tx, companyId);
  let inputVat = dec(0);
  if (input.size) {
    const s = await tx.journalLine.aggregate({
      where: { companyId, accountId: { in: [...input] }, entry: entryWhere },
      _sum: { debit: true, credit: true },
    });
    inputVat = dec(s._sum.debit ?? 0).minus(dec(s._sum.credit ?? 0));
  }

  const kmd = computeKmd(lines, {
    periodStart: from,
    inputVat,
    adjustmentsPlus: opts.adjustmentsPlus ? dec(opts.adjustmentsPlus) : undefined,
    adjustmentsMinus: opts.adjustmentsMinus ? dec(opts.adjustmentsMinus) : undefined,
  });

  // KMD INF: arvete andmed
  const salesIds = [...new Set(lines.filter((l) => l.source === "SALES_INVOICE" && l.documentId).map((l) => l.documentId!))];
  const purchaseIds = [...new Set(lines.filter((l) => l.source === "PURCHASE_INVOICE" && l.documentId).map((l) => l.documentId!))];
  const documents = new Map<string, KmdInfDocument>();
  if (salesIds.length) {
    const invoices = await tx.salesInvoice.findMany({
      where: { companyId, id: { in: salesIds } },
      select: { id: true, number: true, date: true, customerName: true, customerRegCode: true, netTotal: true, totalBase: true, currencyRate: true },
    });
    for (const i of invoices) {
      documents.set(i.id, {
        side: "SALES",
        documentId: i.id,
        partnerRegCode: i.customerRegCode?.trim() || null,
        partnerName: i.customerName,
        invoiceNumber: i.number ?? "",
        invoiceDate: i.date,
        invoiceNet: toBase(i.netTotal, i.currencyRate),
        invoiceGross: dec(i.totalBase),
      });
    }
  }
  if (purchaseIds.length) {
    const invoices = await tx.purchaseInvoice.findMany({
      where: { companyId, id: { in: purchaseIds } },
      select: { id: true, number: true, invoiceNumber: true, date: true, supplierName: true, supplierRegCode: true, netTotal: true, totalBase: true, currencyRate: true },
    });
    for (const i of invoices) {
      documents.set(i.id, {
        side: "PURCHASE",
        documentId: i.id,
        partnerRegCode: i.supplierRegCode?.trim() || null,
        partnerName: i.supplierName,
        invoiceNumber: i.invoiceNumber || i.number || "",
        invoiceDate: i.date,
        invoiceNet: toBase(i.netTotal, i.currencyRate),
        invoiceGross: dec(i.totalBase),
      });
    }
  }
  const inf = computeKmdInf(lines, documents, from);

  const closing = await tx.journalEntry.findFirst({
    where: { companyId, source: "VAT_CLOSING", sourceId: periodKey(opts.year, opts.month) },
    select: { id: true, number: true, date: true },
  });
  return { from, to, kmd, ...inf, closing };
}

export const periodKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
