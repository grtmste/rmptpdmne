import "server-only";
import { db } from "@/lib/db";
import { toISODate } from "@/lib/accounting/dates";
import { openPrepayments } from "@/server/services/sales";
import type { CompanyContext } from "@/server/session";
import type { EditorData } from "./document-editor";

/** Müügidokumendi vormi valikud: kliendid, artiklid, käibemaksud perioodidega, kontod, dimensioonid. */
export async function loadSalesEditorData(ctx: CompanyContext, opts: { prepayments?: boolean } = {}): Promise<EditorData> {
  const today = new Date();
  const [customers, items, vatRates, accounts, departments, dimensions, currencies, company, defaultSales, prepayments] = await Promise.all([
    ctx.cdb.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 5000,
      select: { id: true, name: true, regCode: true, email: true, paymentTermDays: true, currency: true, defaultVatRateId: true },
    }),
    ctx.cdb.item.findMany({
      where: { active: true, forSales: true },
      orderBy: { code: "asc" },
      take: 5000,
      select: { id: true, code: true, name: true, unit: true, salePrice: true, purchasePrice: true, vatRateId: true, salesAccountId: true },
    }),
    ctx.cdb.vatRate.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { periods: { orderBy: { validFrom: "asc" } } },
    }),
    ctx.cdb.glAccount.findMany({
      where: { active: true, kind: "DETAIL", OR: [{ role: null }, { role: { not: "CURRENT_YEAR_PROFIT" } }] },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, requiresDepartment: true, requiredDimensionIds: true },
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
    ctx.cdb.company.findFirstOrThrow({ select: { paymentTermDays: true, baseCurrency: true } }),
    ctx.cdb.glAccount.findFirst({ where: { role: "DEFAULT_SALES" }, select: { id: true, defaultVatRateId: true } }),
    opts.prepayments ? openPrepayments(db, ctx.company.id) : Promise.resolve([]),
  ]);
  return {
    customers: customers.map((c) => ({ ...c })),
    items: items.map((i) => ({
      ...i,
      salePrice: i.salePrice?.toString() ?? "",
      purchasePrice: i.purchasePrice?.toString() ?? "",
    })),
    vatRates: vatRates.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      kind: v.kind,
      periods: v.periods.map((p) => ({ rate: p.rate.toString(), validFrom: toISODate(p.validFrom), validTo: p.validTo ? toISODate(p.validTo) : null })),
    })),
    accounts,
    departments,
    dimensions: dimensions.map((d) => ({ id: d.id, name: d.name, values: d.values })),
    currencies: [...new Set([company.baseCurrency, ...currencies.map((c) => c.code)])],
    baseCurrency: company.baseCurrency,
    paymentTermDays: company.paymentTermDays,
    defaultVatRateId: defaultSales?.defaultVatRateId ?? null,
    prepayments: prepayments.map((p) => ({
      id: p.id,
      number: p.number,
      customerId: p.customerId,
      date: toISODate(p.date),
      remaining: p.remaining,
    })),
  };
}
