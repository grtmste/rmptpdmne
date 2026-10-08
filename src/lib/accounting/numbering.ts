export type SeriesFormat = { prefix: string; suffix: string; yearBased: boolean; padding: number };

/** Dokumendi number, nt "1001", "PR-15", "2026/7", "K-0003". */
export function formatDocumentNumber(series: SeriesFormat, n: number, year: number): string {
  const num = series.padding > 0 ? String(n).padStart(series.padding, "0") : String(n);
  const core = series.yearBased ? `${year}/${num}` : num;
  return `${series.prefix}${core}${series.suffix}`;
}

/**
 * Eesti viitenumber meetodil 7-3-1 (Eesti Pangaliit). Alusnumbrile lisatakse kontrollnumber:
 * numbreid korrutatakse paremalt vasakule kaaludega 7, 3, 1, …; kontrollnumber on summa ja
 * järgmise kümnega jaguva arvu vahe.
 */
export function referenceNumber(base: string | number): string {
  const digits = String(base).replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 19) throw new RangeError("Viitenumbri alus peab olema 1–19 numbrit");
  const weights = [7, 3, 1];
  let total = 0;
  for (let k = 0; k < digits.length; k++) {
    total += Number(digits[digits.length - 1 - k]) * weights[k % 3]!;
  }
  const check = (10 - (total % 10)) % 10;
  return digits + String(check);
}

export function isValidReferenceNumber(ref: string): boolean {
  const digits = ref.replace(/\s/g, "");
  if (!/^\d{2,20}$/.test(digits)) return false;
  return referenceNumber(digits.slice(0, -1)) === digits;
}
