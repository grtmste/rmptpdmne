import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { addDays, addMonths } from "@/lib/accounting/dates";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildIncomeStatement,
  profitOf,
  type AccountInfo,
  type Balances,
} from "@/lib/reports/statements";
import { fiscalYearStart } from "./ledger";

/**
 * Bilanss, kasumiaruanne ja rahavoogude aruanne pearaamatu postitatud kannetest.
 * Päringud on järjestikused, et funktsioone saaks kutsuda ka tehingu sees.
 */

type Tx = Prisma.TransactionClient;

export type StatementFilters = { departmentId?: string | null; dimensionValueId?: string | null };

function where(companyId: string, date: Prisma.DateTimeFilter, f: StatementFilters = {}): Prisma.JournalLineWhereInput {
  return {
    companyId,
    entry: { status: "POSTED", date },
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.dimensionValueId ? { dimensions: { some: { dimensionValueId: f.dimensionValueId } } } : {}),
  };
}

async function sums(tx: Tx, w: Prisma.JournalLineWhereInput): Promise<Balances> {
  const rows = await tx.journalLine.groupBy({ by: ["accountId"], where: w, _sum: { debit: true, credit: true } });
  return new Map(rows.map((r) => [r.accountId, dec(r._sum.debit ?? 0).minus(dec(r._sum.credit ?? 0))]));
}

export async function statementAccounts(tx: Tx, companyId: string) {
  const rows = await tx.glAccount.findMany({
    where: { companyId, kind: "DETAIL" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true, reportLine: true, costFunction: true, role: true },
  });
  return rows;
}

/** Kõigi kontode kumulatiivsed saldod (D − K) kuupäeva seisuga (k.a). */
export function balancesUntil(tx: Tx, companyId: string, date: Date, f?: StatementFilters) {
  return sums(tx, where(companyId, { lte: date }, f));
}

/** Kontode käive (D − K) perioodis. */
export function turnoverBetween(tx: Tx, companyId: string, from: Date, to: Date, f?: StatementFilters) {
  return sums(tx, where(companyId, { gte: from, lte: to }, f));
}

/**
 * Bilansi seis kuupäeval: bilansikontode saldod; varasemate majandusaastate tulem liidetakse
 * jaotamata kasumi kontole (nagu aasta sulgemiskande järel) ja jooksva aasta tulem eraldi reale.
 */
async function balanceState(tx: Tx, companyId: string, accounts: Awaited<ReturnType<typeof statementAccounts>>, date: Date) {
  const fyStart = await fiscalYearStart(tx, companyId, date);
  const all = await balancesUntil(tx, companyId, date);
  const current = await turnoverBetween(tx, companyId, fyStart, date);
  const profit = profitOf(accounts, current);
  const priorProfit = profitOf(accounts, all).minus(profit);
  const balances = new Map(all);
  const extra: AccountInfo[] = [];
  if (!priorProfit.isZero()) {
    const retained = accounts.find((a) => a.role === "RETAINED_EARNINGS");
    const id = retained?.id ?? "__retained";
    if (!retained) extra.push({ id, code: "", name: "", type: "EQUITY", reportLine: "BS_RETAINED_EARNINGS" });
    balances.set(id, (balances.get(id) ?? dec(0)).minus(priorProfit));
  }
  return { balances, profit, fyStart, extra };
}

export async function balanceSheet(tx: Tx, companyId: string, opts: { date: Date; compare: boolean }) {
  const accounts = await statementAccounts(tx, companyId);
  const current = await balanceState(tx, companyId, accounts, opts.date);
  const compareDate = opts.compare ? addDays(current.fyStart, -1) : null;
  const prev = compareDate ? await balanceState(tx, companyId, accounts, compareDate) : null;
  const all: AccountInfo[] = [...accounts, ...current.extra, ...(prev?.extra.filter((e) => !current.extra.some((c) => c.id === e.id)) ?? [])];
  const rows = buildBalanceSheet(all, current, prev);
  const total = (code: string, pick: "amount" | "compare") => rows.find((r) => r.code === code)?.[pick] ?? null;
  const difference = (total("BS_TOTAL_ASSETS", "amount") ?? dec(0)).minus(total("BS_TOTAL_LIABILITIES_EQUITY", "amount") ?? dec(0));
  return { rows, compareDate, difference };
}

export async function incomeStatement(
  tx: Tx,
  companyId: string,
  opts: { from: Date; to: Date; scheme: 1 | 2; compare: boolean } & StatementFilters,
) {
  const accounts = await statementAccounts(tx, companyId);
  const turnover = await turnoverBetween(tx, companyId, opts.from, opts.to, opts);
  const compareFrom = addMonths(opts.from, -12);
  const compareTo = addMonths(opts.to, -12);
  const prev = opts.compare ? await turnoverBetween(tx, companyId, compareFrom, compareTo, opts) : null;
  const rows = buildIncomeStatement(accounts, turnover, prev, opts.scheme);
  return { rows, compare: opts.compare ? { from: compareFrom, to: compareTo } : null };
}

export async function cashFlow(tx: Tx, companyId: string, opts: { from: Date; to: Date }) {
  const accounts = await statementAccounts(tx, companyId);
  const opening = await balancesUntil(tx, companyId, addDays(opts.from, -1));
  const closing = await balancesUntil(tx, companyId, opts.to);
  const turnover = await turnoverBetween(tx, companyId, opts.from, opts.to);
  return buildCashFlow(accounts, opening, closing, turnover);
}

/** Valitud kontode käive jooksva kuu ja aasta alguse seisuga (töölaua vidin). */
export async function accountTurnoverSummary(tx: Tx, companyId: string, today: Date) {
  const accounts = await tx.glAccount.findMany({
    where: { companyId, showOnDashboard: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  if (accounts.length === 0) return [];
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const fyStart = await fiscalYearStart(tx, companyId, today);
  const month = await turnoverBetween(tx, companyId, monthStart, today);
  const year = await turnoverBetween(tx, companyId, fyStart, today);
  const sign = (t: string) => (t === "ASSET" || t === "EXPENSE" ? 1 : -1);
  return accounts.map((a) => ({
    ...a,
    month: (month.get(a.id) ?? dec(0)).times(sign(a.type)) as Decimal,
    year: (year.get(a.id) ?? dec(0)).times(sign(a.type)) as Decimal,
  }));
}
