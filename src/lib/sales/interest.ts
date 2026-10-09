import type Decimal from "decimal.js";
import { dec, roundMoney, type DecimalInput } from "@/lib/money";
import { addDays } from "@/lib/accounting/dates";

/**
 * Viivise arvutus (VÕS § 113): iga tasumisega viivitatud päeva eest protsent tasumata summalt.
 * Tasumise päev loetakse veel viivitatud päevaks; järgmisest päevast väheneb võlg.
 * Ümardus ainult lõpptulemusel.
 */

export type InterestSegment = { from: Date; to: Date; days: number; balance: Decimal; interest: Decimal };

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY) + 1;

export function lateInterest(input: {
  /** Arve summa */
  amount: DecimalInput;
  dueDate: Date;
  /** Laekumised ja kreeditarved (positiivne summa vähendab võlga) */
  payments: Array<{ date: Date; amount: DecimalInput }>;
  /** Arvestuse algus (nt eelmise viivisearve lõpu järgmine päev); vaikimisi tähtajale järgnev päev */
  from?: Date | null;
  /** Arvestuse lõpp (k.a) */
  to: Date;
  /** Viivis % päevas */
  ratePct: DecimalInput;
}) {
  const start0 = addDays(input.dueDate, 1);
  const start = input.from && input.from.getTime() > start0.getTime() ? input.from : start0;
  const empty = { amount: dec(0), days: 0, segments: [] as InterestSegment[] };
  if (start.getTime() > input.to.getTime() || dec(input.ratePct).lessThanOrEqualTo(0)) return empty;

  // Võla muutumise päevad: makse päevale järgnev päev
  const changes = input.payments
    .map((p) => ({ effective: addDays(p.date, 1), amount: dec(p.amount) }))
    .sort((a, b) => a.effective.getTime() - b.effective.getTime());
  let balance = dec(input.amount);
  for (const c of changes) if (c.effective.getTime() <= start.getTime()) balance = balance.minus(c.amount);

  const segments: InterestSegment[] = [];
  let cursor = start;
  const later = changes.filter((c) => c.effective.getTime() > start.getTime() && c.effective.getTime() <= input.to.getTime());
  const rate = dec(input.ratePct).dividedBy(100);
  const push = (from: Date, to: Date) => {
    if (to.getTime() < from.getTime() || !balance.greaterThan(0)) return;
    const n = days(from, to);
    segments.push({ from, to, days: n, balance, interest: balance.times(rate).times(n) });
  };
  for (const c of later) {
    push(cursor, addDays(c.effective, -1));
    balance = balance.minus(c.amount);
    cursor = c.effective;
  }
  push(cursor, input.to);
  const total = segments.reduce((s, x) => s.plus(x.interest), dec(0));
  return { amount: roundMoney(total), days: segments.reduce((s, x) => s + x.days, 0), segments };
}
