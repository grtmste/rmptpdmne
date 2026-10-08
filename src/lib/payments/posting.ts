import type Decimal from "decimal.js";
import { dec, roundMoney, sum, type DecimalInput } from "@/lib/money";

/**
 * Makse kande reeglid.
 *
 * Sidumise summa märk:
 * - arve (müük, ost, kuluaruanne): summa, mille võrra arve tasumata osa väheneb, arve enda märgiga
 *   (tavaline arve +, kreeditarve −);
 * - ettemaks ja konto: makse suunas positiivne (laekumine sisse, väljamakse välja); tasaarveldusel
 *   märgiga (+ = konto kreeditisse nagu raha laekuks, − = deebetisse).
 *
 * Rahaline mõju („cash“, makse valuutas): müügiarve +a, ostuarve ja kuluaruanne −a,
 * ettemaks ja konto: laekumisel +a, väljamaksel −a, tasaarveldusel +a. Kõigi sidumiste mõju summa
 * peab võrduma makse märgiga summaga (laekumine +, väljamakse −, tasaarveldus 0).
 */

export type Direction = "IN" | "OUT" | "NETTING";
export type AllocationKind = "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT" | "PREPAYMENT" | "ACCOUNT";

export function cashEffect(direction: Direction, type: AllocationKind, amount: DecimalInput): Decimal {
  const a = dec(amount);
  switch (type) {
    case "SALES_INVOICE":
      return a;
    case "PURCHASE_INVOICE":
    case "EXPENSE_REPORT":
      return a.negated();
    default:
      return direction === "OUT" ? a.negated() : a;
  }
}

export function signedPaymentAmount(direction: Direction, amount: DecimalInput): Decimal {
  if (direction === "NETTING") return dec(0);
  return direction === "IN" ? dec(amount) : dec(amount).negated();
}

/** Kas sidumiste summa klapib makse summaga. Tagastab vahe (0 = korras). */
export function allocationDifference(direction: Direction, amount: DecimalInput, allocations: Array<{ type: AllocationKind; amount: DecimalInput }>) {
  const effects = sum(allocations.map((a) => cashEffect(direction, a.type, a.amount)));
  return signedPaymentAmount(direction, amount).minus(effects);
}

/**
 * Arve osa eurodes: täielikul tasumisel arve eurosumma jääk (et nõude konto saldo oleks täpselt 0),
 * osalisel proportsionaalselt.
 */
export function documentShareBase(opts: { amount: DecimalInput; total: DecimalInput; totalBase: DecimalInput; paidBefore: DecimalInput; paidBaseBefore?: DecimalInput | null }): Decimal {
  const a = dec(opts.amount);
  const total = dec(opts.total);
  if (total.isZero()) return roundMoney(a);
  if (dec(opts.paidBefore).plus(a).equals(total) && opts.paidBaseBefore !== undefined && opts.paidBaseBefore !== null) {
    return roundMoney(dec(opts.totalBase).minus(dec(opts.paidBaseBefore)));
  }
  return roundMoney(dec(opts.totalBase).times(a).dividedBy(total));
}

export type PostingPart = { accountId: string; credit: Decimal; description?: string | null };

/**
 * Koostab kande read: rahakonto (laekumisel deebet, väljamaksel kreedit), sidumiste read
 * (märgiga kreedit) ja kursivahe tasakaalustav rida.
 */
export function buildPaymentPosting(input: {
  cashAccountId: string | null;
  cashBase: DecimalInput; // märgiga: + laekumine
  parts: PostingPart[];
  fxAccountId: string | null;
}): Array<{ accountId: string; debit: Decimal; credit: Decimal; description?: string | null }> {
  const rows: Array<{ accountId: string; debit: Decimal; credit: Decimal; description?: string | null }> = [];
  const push = (accountId: string, credit: Decimal, description?: string | null) => {
    if (credit.isZero()) return;
    rows.push(credit.isNegative() ? { accountId, debit: credit.negated(), credit: dec(0), description } : { accountId, debit: dec(0), credit, description });
  };
  const cash = dec(input.cashBase);
  if (input.cashAccountId && !cash.isZero()) push(input.cashAccountId, cash.negated());
  // Sama konto read koondatakse
  const byAccount = new Map<string, { credit: Decimal; description?: string | null }>();
  for (const p of input.parts) {
    const prev = byAccount.get(p.accountId);
    byAccount.set(p.accountId, { credit: (prev?.credit ?? dec(0)).plus(p.credit), description: prev ? null : p.description });
  }
  for (const [accountId, p] of byAccount) push(accountId, p.credit, p.description);
  const debits = sum(rows.map((r) => r.debit));
  const credits = sum(rows.map((r) => r.credit));
  const diff = debits.minus(credits);
  if (!diff.isZero()) {
    if (!input.fxAccountId) throw new RangeError("Kursivahe konto puudub");
    push(input.fxAccountId, diff);
  }
  return rows;
}
