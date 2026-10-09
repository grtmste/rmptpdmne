/**
 * Võlgnevuste vanuseline jaotus (kuupäevad UTC keskööl, nagu @db.Date väljad).
 */

const DAY = 86_400_000;

export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);

export const AGING_BUCKETS = ["notDue", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Tähtaja ületamise vahemik seisuga `asOf`. */
export function agingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const overdue = daysBetween(dueDate, asOf);
  if (overdue <= 0) return "notDue";
  if (overdue <= 30) return "d1_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d90plus";
}

/** Nädala (E–P) algus. */
export function weekStart(date: Date): Date {
  const dow = (date.getUTCDay() + 6) % 7; // esmaspäev = 0
  return new Date(date.getTime() - dow * DAY);
}

/** Töölaua graafiku tulbad: vanemad, 4 möödunud nädalat, jooksev nädal, 3 tulevast nädalat, hilisemad. */
export const WEEK_BUCKETS = ["older", "w-4", "w-3", "w-2", "w-1", "w0", "w+1", "w+2", "w+3", "later"] as const;
export type WeekBucket = (typeof WEEK_BUCKETS)[number];

/** Tähtaja nädal jooksva nädala suhtes. */
export function weekBucket(dueDate: Date, today: Date): WeekBucket {
  const diff = Math.round((weekStart(dueDate).getTime() - weekStart(today).getTime()) / (7 * DAY));
  if (diff < -4) return "older";
  if (diff > 3) return "later";
  return (diff === 0 ? "w0" : diff > 0 ? `w+${diff}` : `w${diff}`) as WeekBucket;
}

/** Tulba algus- ja lõppkuupäev (null = lahtine ots). */
export function weekBucketRange(bucket: WeekBucket, today: Date): { from: Date | null; to: Date | null } {
  const start = weekStart(today);
  const at = (weeks: number) => new Date(start.getTime() + weeks * 7 * DAY);
  if (bucket === "older") return { from: null, to: new Date(at(-4).getTime() - DAY) };
  if (bucket === "later") return { from: at(4), to: null };
  const n = bucket === "w0" ? 0 : Number(bucket.slice(1));
  return { from: at(n), to: new Date(at(n + 1).getTime() - DAY) };
}
