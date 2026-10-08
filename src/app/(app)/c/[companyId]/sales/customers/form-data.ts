import "server-only";
import type { CompanyContext } from "@/server/session";

/** Kliendivormi valikud. */
export async function loadCustomerFormData(ctx: CompanyContext) {
  const [groups, vatRates, currencies, company] = await Promise.all([
    ctx.cdb.customerGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.vatRate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.companyCurrency.findMany({ orderBy: { code: "asc" }, select: { code: true } }),
    ctx.cdb.company.findFirstOrThrow({ select: { paymentTermDays: true, lateInterestPct: true, baseCurrency: true, documentLocale: true } }),
  ]);
  return {
    groups,
    vatRates,
    currencies: [...new Set([company.baseCurrency, ...currencies.map((c) => c.code)])],
    defaults: { paymentTermDays: company.paymentTermDays, lateInterestPct: company.lateInterestPct.toString() },
    baseCurrency: company.baseCurrency,
    documentLocale: company.documentLocale,
  };
}
