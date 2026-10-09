import "server-only";
import { toISODate } from "@/lib/accounting/dates";
import type { CompanyContext } from "@/server/session";
import type { PurchaseEditorData } from "./purchase-editor";
import { aiExtractionEnabled } from "@/server/purchases/ai-extract";

/** Ostudokumendi vormi valikud. */
export async function loadPurchaseEditorData(ctx: CompanyContext): Promise<PurchaseEditorData> {
  const today = new Date();
  const [suppliers, items, vatRates, accounts, departments, dimensions, currencies, company, defaultPurchase, ownBanks] = await Promise.all([
    ctx.cdb.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 5000,
      select: {
        id: true,
        name: true,
        regCode: true,
        vatNumber: true,
        bankAccount: true,
        paymentTermDays: true,
        currency: true,
        defaultAccountId: true,
        defaultVatRateId: true,
      },
    }),
    ctx.cdb.item.findMany({
      where: { active: true, forPurchases: true },
      orderBy: { code: "asc" },
      take: 5000,
      select: { id: true, code: true, name: true, unit: true, purchasePrice: true, vatRateId: true, purchaseAccountId: true },
    }),
    ctx.cdb.vatRate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { periods: { orderBy: { validFrom: "asc" } } } }),
    ctx.cdb.glAccount.findMany({
      where: { active: true, kind: "DETAIL", OR: [{ role: null }, { role: { not: "CURRENT_YEAR_PROFIT" } }] },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, defaultVatRateId: true, requiresDepartment: true, requiredDimensionIds: true },
    }),
    ctx.cdb.department.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.cdb.dimension.findMany({
      where: { active: true, kind: "DETAIL" },
      orderBy: { sortOrder: "asc" },
      include: {
        values: {
          where: { active: true, OR: [{ endDate: null }, { endDate: { gte: today } }] },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        },
      },
    }),
    ctx.cdb.companyCurrency.findMany({ orderBy: { code: "asc" }, select: { code: true } }),
    ctx.cdb.company.findFirstOrThrow({ select: { paymentTermDays: true, baseCurrency: true, regCode: true, vatNumber: true } }),
    ctx.cdb.glAccount.findFirst({ where: { role: "DEFAULT_PURCHASE" }, select: { id: true, defaultVatRateId: true } }),
    ctx.cdb.bankAccount.findMany({ where: { iban: { not: null } }, select: { iban: true } }),
  ]);
  const warehouses = await ctx.cdb.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true, name: true } });
  return {
    warehouses,
    suppliers,
    items: items.map((i) => ({ ...i, purchasePrice: i.purchasePrice?.toString() ?? "" })),
    vatRates: vatRates.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      kind: v.kind,
      deductiblePct: v.deductiblePct.toString(),
      periods: v.periods.map((p) => ({ rate: p.rate.toString(), validFrom: toISODate(p.validFrom), validTo: p.validTo ? toISODate(p.validTo) : null })),
    })),
    accounts,
    departments,
    dimensions: dimensions.map((d) => ({ id: d.id, name: d.name, values: d.values })),
    currencies: [...new Set([company.baseCurrency, ...currencies.map((c) => c.code)])],
    baseCurrency: company.baseCurrency,
    paymentTermDays: company.paymentTermDays,
    defaultAccountId: defaultPurchase?.id ?? null,
    defaultVatRateId: defaultPurchase?.defaultVatRateId ?? null,
    // Ostja (meie) andmed – tuvastamisel neid tarnijaks ei peeta
    own: { regCode: company.regCode, vatNumber: company.vatNumber, ibans: ownBanks.map((b) => b.iban!) },
    aiEnabled: aiExtractionEnabled(),
  };
}
