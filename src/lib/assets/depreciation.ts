import type Decimal from "decimal.js";
import { dec, roundMoney, type DecimalInput } from "@/lib/money";

/**
 * Põhivara lineaarne kulum kuu kaupa. Arvestus käib jääkväärtuse põhjal: kuu kulum on
 * (soetusmaksumus − lõppväärtus − akumuleeritud kulum) / järelejäänud kuud. Nii läheb ümardus
 * viimasesse kuusse ning ümberhindamine ja eluea muutus mõjuvad edasiulatuvalt.
 * Kui kuid on vahele jäänud (vara lisati tagantjärele), arvestatakse need järele.
 */

/** Kuu esimene päev (UTC). */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Kuu viimane päev (UTC). */
export function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** Kuude arv alguskuust kuni kuuni `period` (mõlemad kaasa arvatud); 0, kui periood on enne algust. */
export function elapsedMonths(start: Date, period: Date): number {
  return Math.max(0, monthIndex(period) - monthIndex(start) + 1);
}

export type DepreciationInput = {
  cost: DecimalInput;
  residualValue: DecimalInput;
  /** Seni arvestatud kulum kokku (k.a enne LILY SOKID-i arvestatud) */
  accumulated: DecimalInput;
  usefulLifeMonths: number;
  /** Mitme kuu kulum on juba arvestatud */
  monthsDone: number;
  depreciationStart: Date;
};

/** Kuu `period` kulum (koos vahelejäänud kuudega). */
export function depreciationDue(a: DepreciationInput, period: Date): { amount: Decimal; months: number } {
  const elapsed = Math.min(elapsedMonths(a.depreciationStart, period), a.usefulLifeMonths);
  const due = elapsed - a.monthsDone;
  const remainingMonths = a.usefulLifeMonths - a.monthsDone;
  const base = dec(a.cost).minus(dec(a.residualValue)).minus(dec(a.accumulated));
  if (due <= 0 || remainingMonths <= 0 || !base.greaterThan(0)) return { amount: dec(0), months: 0 };
  const amount = due >= remainingMonths ? base : roundMoney(base.times(due).div(remainingMonths));
  return { amount, months: due };
}

/** Edasine kulumiplaan kuude kaupa alates kuust `from` (kuni vara on täielikult amortiseerunud või `limit`). */
export function depreciationSchedule(a: DepreciationInput, from: Date, limit = 600) {
  const rows: Array<{ period: Date; amount: Decimal; bookValue: Decimal }> = [];
  let state = { ...a, accumulated: dec(a.accumulated) };
  let period = monthStart(from);
  for (let i = 0; i < limit; i++) {
    const { amount, months } = depreciationDue(state, period);
    if (months > 0) {
      const accumulated = state.accumulated.plus(amount);
      state = { ...state, accumulated, monthsDone: state.monthsDone + months };
      rows.push({ period, amount, bookValue: dec(a.cost).minus(accumulated) });
    }
    if (state.monthsDone >= a.usefulLifeMonths || !dec(a.cost).minus(dec(a.residualValue)).minus(state.accumulated).greaterThan(0)) break;
    period = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
  }
  return rows;
}

/** Bilansiline (jääk)väärtus. */
export const bookValue = (cost: DecimalInput, accumulated: DecimalInput) => dec(cost).minus(dec(accumulated));
