import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { toISODate } from "@/lib/accounting/dates";
import { WEEK_BUCKETS, weekBucket, weekBucketRange, type WeekBucket } from "@/lib/reports/aging";
import { openDocumentsSummary, type DebtSide } from "./debts";

type Tx = Prisma.TransactionClient;

export type DebtWidget = {
  total: Decimal;
  overdue: Decimal;
  count: number;
  overdueCount: number;
  weeks: Array<{ bucket: WeekBucket; amount: string; from: string | null; to: string | null }>;
};

/** Laekumata müügiarvete / tasumata ostuarvete kokkuvõte tähtaja nädalate kaupa. */
export async function debtWidget(tx: Tx, companyId: string, side: DebtSide, today: Date): Promise<DebtWidget> {
  // Ka kreeditarved (negatiivne saldo), et summa klapiks võlgnevuste aruandega
  const docs = await openDocumentsSummary(tx, companyId, side, today);
  const sums = new Map<WeekBucket, Decimal>(WEEK_BUCKETS.map((b) => [b, dec(0)]));
  let total = dec(0);
  let overdue = dec(0);
  let overdueCount = 0;
  for (const d of docs) {
    const b = weekBucket(d.dueDate, today);
    sums.set(b, sums.get(b)!.plus(d.openBase));
    total = total.plus(d.openBase);
    if (d.dueDate.getTime() < today.getTime() && d.openBase.greaterThan(0)) {
      overdue = overdue.plus(d.openBase);
      overdueCount += 1;
    }
  }
  return {
    total,
    overdue,
    count: docs.length,
    overdueCount,
    weeks: WEEK_BUCKETS.map((bucket) => {
      const r = weekBucketRange(bucket, today);
      return { bucket, amount: sums.get(bucket)!.toFixed(2), from: r.from && toISODate(r.from), to: r.to && toISODate(r.to) };
    }),
  };
}

/** Pangakontod ja kassad saldoga pearaamatust. */
export async function bankWidget(tx: Tx, companyId: string) {
  const accounts = await tx.bankAccount.findMany({
    where: { companyId, active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, kind: true, name: true, iban: true, currency: true, accountId: true },
  });
  const totals = accounts.length
    ? await tx.journalLine.groupBy({
        by: ["accountId"],
        where: { companyId, accountId: { in: [...new Set(accounts.map((a) => a.accountId))] }, entry: { status: "POSTED" } },
        _sum: { debit: true, credit: true },
      })
    : [];
  const balance = new Map(totals.map((x) => [x.accountId, dec(x._sum.debit ?? 0).minus(dec(x._sum.credit ?? 0))]));
  return accounts.map((a) => ({ ...a, balance: balance.get(a.accountId) ?? dec(0) }));
}
