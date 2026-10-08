import "server-only";
import type { CompanyContext } from "@/server/session";

export async function loadSupplierFormData(ctx: CompanyContext) {
  const [groups, vatRates, accounts, currencies, company] = await Promise.all([
    ctx.cdb.supplierGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.vatRate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.glAccount.findMany({
      where: { active: true, kind: "DETAIL", type: { in: ["EXPENSE", "ASSET", "LIABILITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    ctx.cdb.companyCurrency.findMany({ orderBy: { code: "asc" }, select: { code: true } }),
    ctx.cdb.company.findFirstOrThrow({ select: { paymentTermDays: true, baseCurrency: true } }),
  ]);
  return {
    groups,
    vatRates,
    accounts: accounts.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })),
    currencies: [...new Set([company.baseCurrency, ...currencies.map((c) => c.code)])],
    paymentTermDays: company.paymentTermDays,
    baseCurrency: company.baseCurrency,
  };
}
