import { dec, roundMoney, type DecimalInput } from "@/lib/money";
import type Decimal from "decimal.js";
import { inRange } from "./dates";

export type VatPeriodLike = { rate: DecimalInput; validFrom: Date; validTo: Date | null };

/**
 * Leiab käibemaksumäära dokumendi kuupäeva järgi. Tagastab null, kui kuupäeval ei kehti
 * ükski periood (sel juhul ei tohi dokumenti selle käibemaksuga salvestada).
 */
export function resolveVatRate(periods: VatPeriodLike[], date: Date): Decimal | null {
  const match = periods.find((p) => inRange(date, p.validFrom, p.validTo));
  return match ? dec(match.rate) : null;
}

export type PeriodIssue = "overlap" | "invalidRange" | "negativeRate" | "empty";

/** Kontrollib, et perioodid ei kattu, on loogilised ja määrad on mõistlikud. */
export function validateVatPeriods(periods: VatPeriodLike[]): PeriodIssue | null {
  if (periods.length === 0) return "empty";
  for (const p of periods) {
    if (p.validTo && p.validTo.getTime() < p.validFrom.getTime()) return "invalidRange";
    const r = dec(p.rate);
    if (r.isNegative() || r.greaterThan(100)) return "negativeRate";
  }
  const sorted = [...periods].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1]!;
    // Eelmine lõpmatu või lõpeb pärast järgmise algust → kattuvus
    if (!prev.validTo || prev.validTo.getTime() >= sorted[k]!.validFrom.getTime()) return "overlap";
  }
  return null;
}

/**
 * Käibemaks summalt. Ümardus rea tasemel 2 kohani (nagu pearaamat hoiab), dokumendi
 * kogusumma moodustub ümardatud ridade summast.
 */
export function vatAmount(net: DecimalInput, ratePct: DecimalInput): Decimal {
  return roundMoney(dec(net).times(dec(ratePct)).dividedBy(100));
}

/** Käibemaksuga hinnast käibemaksu eraldamine (hinnad KM-ga). */
export function vatFromGross(gross: DecimalInput, ratePct: DecimalInput): Decimal {
  const r = dec(ratePct);
  return roundMoney(dec(gross).times(r).dividedBy(r.plus(100)));
}

/** Mahaarvatav osa sisendkäibemaksust (sõiduauto 50%, proportsionaalne). */
export function deductibleVat(vat: DecimalInput, deductiblePct: DecimalInput): Decimal {
  return roundMoney(dec(vat).times(dec(deductiblePct)).dividedBy(100));
}
