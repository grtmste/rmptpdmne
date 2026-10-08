import "server-only";
import { db } from "@/lib/db";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { defaultPeriod, type LedgerFilters } from "@/server/reports/ledger";
import type { CompanyContext } from "@/server/session";

type Params = Record<string, string | string[] | undefined>;

export type ReportQuery = LedgerFilters & {
  fromIso: string;
  toIso: string;
  includeZero: boolean;
  page: number;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Aruande filtrid URL-i parameetritest. Kontod, osakond ja dimensiooni väärtus kontrollitakse
 * ettevõtte vastu (võõra ID korral jäetakse filter välja).
 */
export async function parseReportQuery(ctx: CompanyContext, sp: Params): Promise<ReportQuery> {
  const defaults = await defaultPeriod(db, ctx.company.id, todayLocal());
  let from = parseISODate(str(sp.from)) ?? defaults.from;
  let to = parseISODate(str(sp.to)) ?? defaults.to;
  if (from.getTime() > to.getTime()) [from, to] = [to, from];

  const rawAccounts = (Array.isArray(sp.account) ? sp.account : str(sp.account) ? [str(sp.account)] : []).slice(0, 50);
  const accountIds = rawAccounts.length
    ? (await ctx.cdb.glAccount.findMany({ where: { id: { in: rawAccounts } }, select: { id: true } })).map((a) => a.id)
    : [];
  const departmentId = str(sp.department)
    ? ((await ctx.cdb.department.findFirst({ where: { id: str(sp.department) }, select: { id: true } }))?.id ?? null)
    : null;
  const dimensionValueId = str(sp.dimension)
    ? ((await ctx.cdb.dimensionValue.findFirst({ where: { id: str(sp.dimension) }, select: { id: true } }))?.id ?? null)
    : null;

  return {
    from,
    to,
    fromIso: toISODate(from),
    toIso: toISODate(to),
    accountIds,
    departmentId,
    dimensionValueId,
    includeZero: str(sp.zero) === "1",
    page: Math.max(1, Number(str(sp.page)) || 1),
  };
}

/** Filtrivormi valikud. */
export async function loadFilterOptions(ctx: CompanyContext) {
  const [accounts, departments, dimensions] = await Promise.all([
    ctx.cdb.glAccount.findMany({ where: { kind: "DETAIL" }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.cdb.department.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.cdb.dimension.findMany({
      where: { kind: "DETAIL" },
      orderBy: { sortOrder: "asc" },
      select: { name: true, values: { orderBy: { code: "asc" }, select: { id: true, code: true, name: true } } },
    }),
  ]);
  return {
    accounts: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
    departments: departments.map((d) => ({ value: d.id, label: `${d.code} ${d.name}` })),
    dimensionValues: dimensions.flatMap((d) => d.values.map((v) => ({ value: v.id, label: `${d.name}: ${v.code} ${v.name}` }))),
  };
}
