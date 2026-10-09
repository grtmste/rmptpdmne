/**
 * Maksutähtajad. Kuupäevad on kalendripäevad (ilma kellaajata), arvutus UTC-s.
 *
 * KMD ja KMD INF tuleb esitada maksustamisperioodile (kalendrikuu) järgneva kuu 20. kuupäevaks.
 * Kui tähtpäev langeb puhkepäevale (laupäev, pühapäev või riigipüha), nihkub see järgmisele tööpäevale.
 * Majandusaasta aruanne tuleb esitada 6 kuu jooksul majandusaasta lõpust.
 */

export type VatDeadline = {
  /** Maksustamisperioodi kuu, nt "2026-09" */
  period: string;
  dueDate: Date;
};

function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

/** Ülestõusmispühade 1. püha (Gaussi/Meeuse algoritm, Gregoriuse kalender). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month - 1, day);
}

/** Eesti riigipühad, mis võivad langeda tööpäevale (pühapäevased pühad ei mõjuta tähtaegu). */
const FIXED_HOLIDAYS = ["01-01", "02-24", "05-01", "06-23", "06-24", "08-20", "12-24", "12-25", "12-26"];

export function isPublicHoliday(date: Date): boolean {
  const md = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  if (FIXED_HOLIDAYS.includes(md)) return true;
  const easter = easterSunday(date.getUTCFullYear());
  const goodFriday = utcDate(easter.getUTCFullYear(), easter.getUTCMonth(), easter.getUTCDate() - 2);
  return date.getTime() === goodFriday.getTime();
}

export function nextWorkingDay(date: Date): Date {
  const d = new Date(date);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || isPublicHoliday(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Majandusaasta aruande esitamise tähtaeg: 6 kuu möödumisel majandusaasta lõpust (järgmine tööpäev). */
export function annualReportDeadline(fiscalYearEnd: Date): Date {
  const end = utcDate(fiscalYearEnd.getUTCFullYear(), fiscalYearEnd.getUTCMonth() + 7, 0);
  return nextWorkingDay(end);
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
