import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { calendarYearOf } from "@/lib/accounting/fiscal";

/**
 * Pearaamatu aruanded (käibeandmik, pearaamat, päevaraamat). Arvestatakse ainult postitatud
 * kandeid. Tulu- ja kulukontode algsaldo algab iga majandusaasta alguses nullist; varasemate
 * aastate tulem liidetakse jaotamata kasumi konto algsaldole (nagu aasta sulgemiskande järel).
 */

type Tx = Prisma.TransactionClient;
type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export type LedgerFilters = {
  from: Date;
  to: Date;
  accountIds?: string[];
  departmentId?: string | null;
  dimensionValueId?: string | null;
};

const isPnl = (t: AccountType) => t === "INCOME" || t === "EXPENSE";

function lineWhere(companyId: string, f: Omit<LedgerFilters, "from" | "to">, date: Prisma.DateTimeFilter) {
  return {
    companyId,
    entry: { status: "POSTED" as const, date },
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.dimensionValueId ? { dimensions: { some: { dimensionValueId: f.dimensionValueId } } } : {}),
  } satisfies Prisma.JournalLineWhereInput;
}

async function sums(tx: Tx, where: Prisma.JournalLineWhereInput) {
  const rows = await tx.journalLine.groupBy({ by: ["accountId"], where, _sum: { debit: true, credit: true } });
  return new Map(rows.map((r) => [r.accountId, dec(r._sum.debit ?? 0).minus(dec(r._sum.credit ?? 0))]));
}

/** Majandusaasta algus, mis sisaldab kuupäeva (puudumisel kalendriaasta algus). */
export async function fiscalYearStart(tx: Tx, companyId: string, date: Date): Promise<Date> {
  const year = await tx.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    select: { startDate: true },
  });
  return year?.startDate ?? calendarYearOf(date).startDate;
}

/**
 * Algsaldod (deebet − kreedit) konto kaupa kuupäeva `from` seisuga, arvestades tulude-kulude
 * nullimist majandusaasta alguses.
 */
export async function openingBalances(tx: Tx, companyId: string, f: LedgerFilters) {
  const accounts = await tx.glAccount.findMany({ where: { companyId }, select: { id: true, type: true, role: true } });
  const fyStart = await fiscalYearStart(tx, companyId, f.from);
  const [before, sinceFy] = await Promise.all([
    sums(tx, lineWhere(companyId, f, { lt: f.from })),
    sums(tx, lineWhere(companyId, f, { gte: fyStart, lt: f.from })),
  ]);
  const result = new Map<string, Decimal>();
  let priorPnl = dec(0);
  for (const a of accounts) {
    const all = before.get(a.id) ?? dec(0);
    if (isPnl(a.type)) {
      const current = sinceFy.get(a.id) ?? dec(0);
      result.set(a.id, current);
      priorPnl = priorPnl.plus(all.minus(current));
    } else {
      result.set(a.id, all);
    }
  }
  const retained = accounts.find((a) => a.role === "RETAINED_EARNINGS");
  if (retained && !priorPnl.isZero()) result.set(retained.id, (result.get(retained.id) ?? dec(0)).plus(priorPnl));
  return result;
}

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  /** Saldod märgiga: positiivne = deebet, negatiivne = kreedit */
  opening: Decimal;
  debit: Decimal;
  credit: Decimal;
  closing: Decimal;
};

export async function trialBalance(tx: Tx, companyId: string, f: LedgerFilters & { includeZero?: boolean }) {
  const [accounts, opening, turnover] = await Promise.all([
    tx.glAccount.findMany({
      where: { companyId, kind: "DETAIL", ...(f.accountIds?.length ? { id: { in: f.accountIds } } : {}) },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    openingBalances(tx, companyId, f),
    tx.journalLine.groupBy({
      by: ["accountId"],
      where: lineWhere(companyId, f, { gte: f.from, lte: f.to }),
      _sum: { debit: true, credit: true },
    }),
  ]);
  const turnoverBy = new Map(turnover.map((t) => [t.accountId, t._sum]));
  const rows: TrialBalanceRow[] = [];
  for (const a of accounts) {
    const o = opening.get(a.id) ?? dec(0);
    const t = turnoverBy.get(a.id);
    const debit = dec(t?.debit ?? 0);
    const credit = dec(t?.credit ?? 0);
    const closing = o.plus(debit).minus(credit);
    if (!f.includeZero && o.isZero() && debit.isZero() && credit.isZero()) continue;
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, opening: o, debit, credit, closing });
  }
  const total = (pick: (r: TrialBalanceRow) => Decimal) => rows.reduce((s, r) => s.plus(pick(r)), dec(0));
  const sideTotal = (pick: (r: TrialBalanceRow) => Decimal, positive: boolean) =>
    rows.reduce((s, r) => {
      const v = pick(r);
      return positive ? (v.isPositive() ? s.plus(v) : s) : v.isNegative() ? s.plus(v.negated()) : s;
    }, dec(0));
  return {
    rows,
    totals: {
      openingDebit: sideTotal((r) => r.opening, true),
      openingCredit: sideTotal((r) => r.opening, false),
      debit: total((r) => r.debit),
      credit: total((r) => r.credit),
      closingDebit: sideTotal((r) => r.closing, true),
      closingCredit: sideTotal((r) => r.closing, false),
    },
  };
}

export type LedgerLine = {
  entryId: string;
  number: string | null;
  date: Date;
  source: string;
  description: string | null;
  debit: Decimal;
  credit: Decimal;
  balance: Decimal;
};

export type LedgerAccount = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  opening: Decimal;
  lines: LedgerLine[];
  debit: Decimal;
  credit: Decimal;
  closing: Decimal;
};

/** Pearaamat: konto kaupa algsaldo, perioodi read jooksva saldoga ja lõppsaldo. */
export async function generalLedger(tx: Tx, companyId: string, f: LedgerFilters, limit = 5000) {
  const [opening, lines] = await Promise.all([
    openingBalances(tx, companyId, f),
    tx.journalLine.findMany({
      where: {
        ...lineWhere(companyId, f, { gte: f.from, lte: f.to }),
        ...(f.accountIds?.length ? { accountId: { in: f.accountIds } } : {}),
      },
      orderBy: [{ account: { code: "asc" } }, { entry: { date: "asc" } }, { entry: { number: "asc" } }, { sortOrder: "asc" }],
      take: limit + 1,
      include: {
        account: { select: { id: true, code: true, name: true, type: true } },
        entry: { select: { id: true, number: true, date: true, source: true, description: true } },
      },
    }),
  ]);
  const truncated = lines.length > limit;
  const byAccount = new Map<string, LedgerAccount>();
  for (const l of lines.slice(0, limit)) {
    let acc = byAccount.get(l.accountId);
    if (!acc) {
      const o = opening.get(l.accountId) ?? dec(0);
      acc = { ...l.account, accountId: l.accountId, opening: o, lines: [], debit: dec(0), credit: dec(0), closing: o };
      byAccount.set(l.accountId, acc);
    }
    acc.debit = acc.debit.plus(l.debit.toString());
    acc.credit = acc.credit.plus(l.credit.toString());
    acc.closing = acc.closing.plus(l.debit.toString()).minus(l.credit.toString());
    acc.lines.push({
      entryId: l.entry.id,
      number: l.entry.number,
      date: l.entry.date,
      source: l.entry.source,
      description: l.description || l.entry.description,
      debit: dec(l.debit.toString()),
      credit: dec(l.credit.toString()),
      balance: acc.closing,
    });
  }
  // Valitud kontod, millel perioodis liikumist polnud, kuid saldo on olemas
  if (f.accountIds?.length) {
    const missing = f.accountIds.filter((id) => !byAccount.has(id));
    if (missing.length) {
      const accounts = await tx.glAccount.findMany({
        where: { companyId, id: { in: missing } },
        select: { id: true, code: true, name: true, type: true },
      });
      for (const a of accounts) {
        const o = opening.get(a.id) ?? dec(0);
        byAccount.set(a.id, { ...a, accountId: a.id, opening: o, lines: [], debit: dec(0), credit: dec(0), closing: o });
      }
    }
  }
  const accounts = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { accounts, truncated };
}

/** Päevaraamat: kanded kronoloogiliselt koos ridadega, lehekülgede kaupa. */
export async function dayBook(tx: Tx, companyId: string, f: LedgerFilters, page = 1, pageSize = 50) {
  const where: Prisma.JournalEntryWhereInput = {
    companyId,
    status: "POSTED",
    date: { gte: f.from, lte: f.to },
    ...(f.departmentId || f.dimensionValueId || f.accountIds?.length
      ? {
          lines: {
            some: {
              ...(f.departmentId ? { departmentId: f.departmentId } : {}),
              ...(f.dimensionValueId ? { dimensions: { some: { dimensionValueId: f.dimensionValueId } } } : {}),
              ...(f.accountIds?.length ? { accountId: { in: f.accountIds } } : {}),
            },
          },
        }
      : {}),
  };
  const [total, entries] = await Promise.all([
    tx.journalEntry.count({ where }),
    tx.journalEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { number: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lines: {
          orderBy: { sortOrder: "asc" },
          include: { account: { select: { code: true, name: true } } },
        },
      },
    }),
  ]);
  return { total, page, pageSize, entries };
}

/** Vaikimisi periood: jooksva majandusaasta algusest tänaseni. */
export async function defaultPeriod(tx: Tx, companyId: string, today: Date) {
  return { from: await fiscalYearStart(tx, companyId, today), to: today };
}

