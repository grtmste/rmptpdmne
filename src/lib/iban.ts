/** IBAN-i kuju: tühikuteta suurtähtedes. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** IBAN kontrollsumma (ISO 13616, mod 97). */
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("EE") && iban.length !== 20) return false;
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
