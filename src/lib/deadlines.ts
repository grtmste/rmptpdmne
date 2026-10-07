/**
 * Maksutähtajad. Kuupäevad on kalendripäevad (ilma kellaajata), arvutus UTC-s.
 *
 * KMD ja KMD INF tuleb esitada maksustamisperioodile (kalendrikuu) järgneva kuu 20. kuupäevaks.
 * Kui tähtpäev langeb laupäevale või pühapäevale, nihkub see järgmisele tööpäevale.
 * (Riigipühad lisanduvad koos tööpäevade kalendriga faasis 6.)
 */

export type VatDeadline = {
  /** Maksustamisperioodi kuu, nt "2026-09" */
  period: string;
  dueDate: Date;
};

function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

export function nextWorkingDay(date: Date): Date {
  const d = new Date(date);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Järgmine KMD tähtaeg, mis ei ole veel möödas (tähtaja päev ise loeb kehtivaks). */
export function nextVatDeadline(today: Date): VatDeadline {
  const t = utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let offset = 0; offset < 3; offset++) {
    const due = nextWorkingDay(utcDate(t.getUTCFullYear(), t.getUTCMonth() + offset, 20));
    if (due >= t) {
      const periodStart = utcDate(t.getUTCFullYear(), t.getUTCMonth() + offset - 1, 1);
      const period = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
      return { period, dueDate: due };
    }
  }
  throw new Error("unreachable");
}

export function daysUntil(today: Date, target: Date): number {
  const a = utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target.getTime() - a.getTime()) / 86_400_000);
}
