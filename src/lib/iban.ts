/** IBAN-i kuju: tühikuteta suurtähtedes. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Riikide IBAN-i pikkused (sagedasemad partnerriigid). */
const IBAN_LENGTHS: Record<string, number> = { EE: 20, LV: 21, LT: 20, FI: 18, SE: 24, DE: 22, PL: 28, GB: 22, NL: 18, DK: 18, NO: 15, FR: 27, ES: 24, IT: 27, IE: 22, AT: 20, BE: 16, CH: 21 };

/** Miks IBAN ei sobi: kuju, riigi pikkus või kontrollsumma (null = korras). */
export function ibanIssue(value: string): "ibanFormat" | "ibanLength" | "iban" | null {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return "ibanFormat";
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return "ibanLength";
  return isValidIban(iban) ? null : "iban";
}

/** IBAN kontrollsumma (ISO 13616, mod 97). */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** IBAN loetavalt neljakaupa: EE38 2200 2210 2014 5685 */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}
