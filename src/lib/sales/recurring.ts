import { addDays, addMonths } from "@/lib/accounting/dates";

/**
 * Perioodilise arve ajakava ja tekstide kohatäited.
 *
 * n-is arve kuupäev arvutatakse alati alguskuupäevast (algus + n × kordus), mitte eelmisest
 * arvest – nii ei „kahane“ 31. kuupäev pärast veebruari 28-ks.
 */
export function occurrenceDate(startDate: Date, intervalMonths: number, n: number): Date {
  return addMonths(startDate, intervalMonths * n);
}

/** Järgmine arve kuupäev pärast `runCount` tehtud arvet; null, kui ajakava on lõppenud. */
export function nextOccurrence(startDate: Date, intervalMonths: number, runCount: number, endDate: Date | null): Date | null {
  const next = occurrenceDate(startDate, intervalMonths, runCount);
  return endDate && next.getTime() > endDate.getTime() ? null : next;
}

const MONTHS: Record<string, string[]> = {
  et: ["jaanuar", "veebruar", "märts", "aprill", "mai", "juuni", "juuli", "august", "september", "oktoober", "november", "detsember"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fi: ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"],
  ru: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
};

const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

/**
 * Asendab arve tekstides kohatäited arve kuupäeva järgi (suur- ja väiketähed ei loe):
 *   [kuu] / [month] – kuu nimi, [aasta] / [year] – aasta,
 *   [periood] / [period] – kuu ja aasta või mitmekuulise korduse korral kuupäevavahemik,
 *   [järgmine kuu] / [next month] – järgmise kuu nimi.
 */
export function fillPlaceholders(text: string, opts: { date: Date; intervalMonths: number; locale: string }): string {
  const names = MONTHS[opts.locale] ?? MONTHS.et!;
  const month = names[opts.date.getUTCMonth()]!;
  const nextMonth = names[(opts.date.getUTCMonth() + 1) % 12]!;
  const year = String(opts.date.getUTCFullYear());
  const periodStart = new Date(Date.UTC(opts.date.getUTCFullYear(), opts.date.getUTCMonth(), 1));
  const period =
    opts.intervalMonths <= 1 ? `${month} ${year}` : `${fmt(periodStart)}–${fmt(addDays(addMonths(periodStart, opts.intervalMonths), -1))}`;
  return text
    .replace(/\[(järgmine kuu|next month)\]/gi, nextMonth)
    .replace(/\[(kuu|month)\]/gi, month)
    .replace(/\[(aasta|year)\]/gi, year)
    .replace(/\[(periood|period)\]/gi, period);
}
