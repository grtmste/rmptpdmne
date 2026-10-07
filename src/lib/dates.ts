export const APP_TIME_ZONE = "Europe/Tallinn";

/** Tänane kalendripäev Eesti ajas, esitatud UTC keskööna (sobib @db.Date väljadega). */
export function todayLocal(now = new Date()): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(now);
  return new Date(`${iso}T00:00:00Z`);
}

/** Kuupäev kasutajale, nt et: 20.10.2026 */
export function formatDate(date: Date, locale = "et"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
