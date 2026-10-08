/**
 * Valuutad ja Euroopa Keskpanga (EKP) kursid. Eesti Pank avaldab samu EKP võrdluskursse.
 * Kurss tähendab: 1 EUR = rate valuutat.
 */

/** Valuutad, mille kohta EKP avaldab võrdluskursi (+ EUR). */
export const CURRENCIES = [
  "EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF", "PLN", "CZK", "HUF", "RON", "BGN", "ISK", "TRY",
  "JPY", "CNY", "AUD", "CAD", "NZD", "HKD", "SGD", "KRW", "INR", "IDR", "ILS", "MYR", "MXN", "BRL",
  "PHP", "THB", "ZAR",
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export function isCurrency(code: string): code is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(code);
}

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_90D_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

export type EcbRate = { date: string; currency: string; rate: string };

/** Loeb EKP XML-i (päevane või ajalugu). Tagastab kõik kuupäev × valuuta kursid. */
export function parseEcbXml(xml: string): EcbRate[] {
  const result: EcbRate[] = [];
  const dayRe = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
  const rateRe = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;
  for (const day of xml.matchAll(dayRe)) {
    for (const r of day[2]!.matchAll(rateRe)) {
      result.push({ date: day[1]!, currency: r[1]!, rate: r[2]! });
    }
  }
  return result;
}
