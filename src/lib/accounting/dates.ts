/**
 * Kalendripäevad (ilma kellaajata). Hoiame neid Date-objektidena UTC keskööl, mis vastab
 * Prisma @db.Date väljadele.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(value: string): Date | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Kontrollime, et kuupäev on päriselt olemas (nt 2026-02-30 ei ole)
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Lisab kuud; tulemuseks on sama kuupäev või kuu viimane päev. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

/** Kuude arv vahemikus [start, end], kus end on viimane päev (nt 01.01–31.12 = 12). */
export function monthSpan(start: Date, end: Date): number {
  const next = addDays(end, 1);
  return (next.getUTCFullYear() - start.getUTCFullYear()) * 12 + (next.getUTCMonth() - start.getUTCMonth());
}

export function isSameOrBefore(a: Date, b: Date): boolean {
  return a.getTime() <= b.getTime();
}

export function inRange(date: Date, from: Date, to: Date | null | undefined): boolean {
  return date.getTime() >= from.getTime() && (!to || date.getTime() <= to.getTime());
}
