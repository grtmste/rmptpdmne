/** Riigid valikus: EL liikmesriigid ja sagedasemad kaubanduspartnerid. Nimi tuleb Intl-ist. */
export const EU_COUNTRIES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
] as const;

export const OTHER_COUNTRIES = ["NO", "CH", "GB", "IS", "UA", "US", "CA", "CN", "JP", "AU", "TR", "IL", "AE", "IN", "SG"] as const;

export const COUNTRIES = [...EU_COUNTRIES, ...OTHER_COUNTRIES] as const;

export function isEuCountry(code: string): boolean {
  return (EU_COUNTRIES as readonly string[]).includes(code.toUpperCase());
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Riikide valik nime järgi sorteeritult (Eesti esimesena). */
export function countryOptions(locale: string) {
  return [...COUNTRIES]
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((a, b) => (a.code === "EE" ? -1 : b.code === "EE" ? 1 : a.name.localeCompare(b.name, locale)));
}
