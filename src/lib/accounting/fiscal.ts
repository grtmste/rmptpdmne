import { addDays, addMonths, monthSpan } from "./dates";

export type FiscalYearLike = { id?: string; startDate: Date; endDate: Date; closedAt?: Date | null };

export type FiscalIssue = "invalidRange" | "tooLong" | "overlap";

/** Majandusaasta võib olla kuni 18 kuud (asutamisel või aasta muutmisel; RPS § 13). */
export const MAX_FISCAL_YEAR_MONTHS = 18;

export function validateFiscalYear(year: FiscalYearLike, others: FiscalYearLike[]): FiscalIssue | null {
  if (year.endDate.getTime() < year.startDate.getTime()) return "invalidRange";
  if (monthSpan(year.startDate, year.endDate) > MAX_FISCAL_YEAR_MONTHS) return "tooLong";
  for (const o of others) {
    if (o.id && o.id === year.id) continue;
    if (year.startDate.getTime() <= o.endDate.getTime() && o.startDate.getTime() <= year.endDate.getTime()) {
      return "overlap";
    }
  }
  return null;
}

/** Järgmine 12-kuuline aasta pärast viimast olemasolevat. */
export function nextFiscalYear(existing: FiscalYearLike[]): { startDate: Date; endDate: Date } | null {
  if (existing.length === 0) return null;
  const last = existing.reduce((a, b) => (a.endDate.getTime() > b.endDate.getTime() ? a : b));
  const startDate = addDays(last.endDate, 1);
  return { startDate, endDate: addDays(addMonths(startDate, 12), -1) };
}

/** Kalendriaasta, mis sisaldab kuupäeva (vaikimisi majandusaasta). */
export function calendarYearOf(date: Date): { startDate: Date; endDate: Date } {
  const y = date.getUTCFullYear();
  return { startDate: new Date(Date.UTC(y, 0, 1)), endDate: new Date(Date.UTC(y, 11, 31)) };
}

export type PeriodState = "open" | "locked" | "closedYear" | "noFiscalYear";

/**
 * Kas kuupäevale tohib kandeid lisada/muuta. Reeglid:
 * - kuupäev peab jääma mõnda majandusaastasse;
 * - see majandusaasta ei tohi olla suletud;
 * - kuupäev peab olema hilisem kui ettevõtte lukustuskuupäev.
 */
export function periodState(date: Date, years: FiscalYearLike[], lockedUntil: Date | null | undefined): PeriodState {
  const year = years.find((y) => date.getTime() >= y.startDate.getTime() && date.getTime() <= y.endDate.getTime());
  if (!year) return "noFiscalYear";
  if (year.closedAt) return "closedYear";
  if (lockedUntil && date.getTime() <= lockedUntil.getTime()) return "locked";
  return "open";
}
