import type Decimal from "decimal.js";
import { dec, sum, type DecimalInput } from "@/lib/money";

/**
 * Kahekordse kirjenduse reeglid. Puhtad funktsioonid – andmebaasi kirjutab
 * src/server/services/journal.ts.
 */

export type LineInput = {
  accountId: string;
  debit?: DecimalInput;
  credit?: DecimalInput;
};

export type EntryIssue =
  | { code: "noLines" }
  | { code: "lineBothSides"; index: number }
  | { code: "lineEmpty"; index: number }
  | { code: "negativeAmount"; index: number }
  | { code: "tooManyDecimals"; index: number }
  | { code: "unbalanced"; debit: string; credit: string };

export type EntryTotals = { debit: Decimal; credit: Decimal; difference: Decimal };

export function entryTotals(lines: LineInput[]): EntryTotals {
  const debit = sum(lines.map((l) => l.debit ?? 0));
  const credit = sum(lines.map((l) => l.credit ?? 0));
  return { debit, credit, difference: debit.minus(credit) };
}

/** Kontrollib kande ridu. Tagastab esimese vea või null, kui kanne on korras. */
export function validateEntryLines(lines: LineInput[]): EntryIssue | null {
  if (lines.length === 0) return { code: "noLines" };
  for (let index = 0; index < lines.length; index++) {
    const d = dec(lines[index]!.debit ?? 0);
    const c = dec(lines[index]!.credit ?? 0);
    if (d.isNegative() || c.isNegative()) return { code: "negativeAmount", index };
    if (d.decimalPlaces() > 2 || c.decimalPlaces() > 2) return { code: "tooManyDecimals", index };
    if (!d.isZero() && !c.isZero()) return { code: "lineBothSides", index };
    if (d.isZero() && c.isZero()) return { code: "lineEmpty", index };
  }
  const t = entryTotals(lines);
  if (!t.difference.isZero()) {
    return { code: "unbalanced", debit: t.debit.toFixed(2), credit: t.credit.toFixed(2) };
  }
  return null;
}

/**
 * Konto saldo märgiga: varade ja kulude saldo on deebetis positiivne, kohustiste, omakapitali
 * ja tulude saldo kreeditis positiivne.
 */
export function naturalBalance(
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE",
  debit: DecimalInput,
  credit: DecimalInput,
): Decimal {
  const d = dec(debit).minus(dec(credit));
  return type === "ASSET" || type === "EXPENSE" ? d : d.negated();
}

/** Konto tüüp koodi esimese numbri järgi (kasutajaliideses vaikimisi valik). */
export function accountTypeFromCode(code: string): "ASSET" | "LIABILITY" | "EXPENSE" | "INCOME" | null {
  switch (code.trim()[0]) {
    case "1":
      return "ASSET";
    case "2":
      return "LIABILITY";
    case "3":
      return "INCOME";
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
      return "EXPENSE";
    default:
      return null;
  }
}
