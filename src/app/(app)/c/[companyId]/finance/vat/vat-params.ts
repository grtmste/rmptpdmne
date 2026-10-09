import { todayLocal } from "@/lib/dates";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** KMD periood URL-ist (`period=YYYY-MM`), vaikimisi eelmine kuu; korrigeerimised read 10 ja 11. */
export function parseVatQuery(sp: Record<string, string | string[] | undefined>) {
  const m = /^(\d{4})-(\d{2})$/.exec(str(sp.period));
  const today = todayLocal();
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth(); // eelmine kuu (0 = detsember eelmisel aastal)
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    year = Number(m[1]);
    month = Number(m[2]);
  }
  const amount = (v: string) => (/^\d{1,12}([.,]\d{1,2})?$/.test(v) ? v.replace(",", ".") : null);
  return {
    year,
    month,
    period: `${year}-${String(month).padStart(2, "0")}`,
    adjustmentsPlus: amount(str(sp.plus)),
    adjustmentsMinus: amount(str(sp.minus)),
  };
}

/** next-intl võti KMD rea koodist (punktid ja ülaindeksid ei sobi võtmesse). */
export const kmdKey = (code: string) => `l${code.replace(/\./g, "_").replace("¹", "a").replace("²", "b")}`;
