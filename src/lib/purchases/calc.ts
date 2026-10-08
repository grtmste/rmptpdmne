import type Decimal from "decimal.js";
import { dec, roundMoney, sum, type DecimalInput } from "@/lib/money";
import { lineAmount, spread, toBase, type VatKindLike } from "@/lib/sales/calc";

/**
 * Ostudokumendi (ostuarve, tellimus, kuluaruanne) summad.
 *
 * - Maksustatav ost (TAXABLE): tarnija arvel olev käibemaks, arvutatud määra kaupa dokumendi
 *   tasemel nagu müügiarvel; „hinnad KM-ga“ korral eraldatakse KM brutosummast.
 * - Pöördmaksustamine: EL teenus (EU_SERVICES), EL kaup (ZERO_EU_GOODS) ja siseriiklik
 *   pöördmaksustamine (REVERSE_CHARGE). Tarnija arvel KM-i pole; ostja arvestab selle ise
 *   standardmääraga (või koodi määraga, kui see ei ole 0%) ja arvab samas ulatuses maha.
 * - Mahaarvatav osa: KM × koodi mahaarvatav % (sõiduauto 50%, proportsionaalne KM).
 *   Mitte mahaarvatav osa lisandub kulule.
 */

export type PurchaseCalcLine = {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  discountPct?: DecimalInput | null;
  vatRateId?: string | null;
  vatPct?: DecimalInput | null;
  vatKind?: VatKindLike | null;
  /** Mahaarvatav osa protsentides (vaikimisi 100) */
  deductiblePct?: DecimalInput | null;
};

export type PurchaseLineResult = {
  amount: Decimal;
  net: Decimal;
  /** Tarnija arvel olev KM */
  vat: Decimal;
  /** Pöördmaksustatav KM */
  reverseVat: Decimal;
  /** Mahaarvatav sisendkäibemaks */
  deductible: Decimal;
};

export type PurchaseCalcResult = {
  lines: PurchaseLineResult[];
  net: Decimal;
  vat: Decimal;
  total: Decimal;
  reverseVat: Decimal;
  deductible: Decimal;
};

const REVERSE_KINDS: ReadonlyArray<VatKindLike> = ["EU_SERVICES", "ZERO_EU_GOODS", "REVERSE_CHARGE"];

export function isReverseCharge(kind: VatKindLike | null | undefined): boolean {
  return Boolean(kind && REVERSE_KINDS.includes(kind));
}

export function calculatePurchase(
  lines: PurchaseCalcLine[],
  opts: { pricesIncludeVat: boolean; /** Standardmäär pöördmaksustamiseks (0% koodide korral) */ standardPct?: DecimalInput | null },
): PurchaseCalcResult {
  const results: PurchaseLineResult[] = lines.map((l) => {
    const amount = lineAmount(l);
    return { amount, net: amount, vat: dec(0), reverseVat: dec(0), deductible: dec(0) };
  });

  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const key = `${l.vatRateId ?? ""}|${dec(l.vatPct ?? 0).toFixed(2)}|${l.vatKind ?? ""}|${dec(l.deductiblePct ?? 100).toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });

  for (const idx of groups.values()) {
    const first = lines[idx[0]!]!;
    const kind = first.vatKind ?? null;
    const amounts = idx.map((i) => results[i]!.amount);
    const groupAmount = sum(amounts);
    const deductiblePct = dec(first.deductiblePct ?? 100);
    let vats: Decimal[] = idx.map(() => dec(0));

    if (kind === "TAXABLE") {
      const pct = dec(first.vatPct ?? 0);
      if (pct.isZero()) continue;
      if (opts.pricesIncludeVat) {
        const groupVat = roundMoney(groupAmount.times(pct).dividedBy(pct.plus(100)));
        vats = spread(groupVat, amounts, (a) => a.times(pct).dividedBy(pct.plus(100)));
        idx.forEach((i, k) => {
          results[i]!.vat = vats[k]!;
          results[i]!.net = results[i]!.amount.minus(vats[k]!);
        });
      } else {
        const groupVat = roundMoney(groupAmount.times(pct).dividedBy(100));
        vats = spread(groupVat, amounts, (a) => a.times(pct).dividedBy(100));
        idx.forEach((i, k) => (results[i]!.vat = vats[k]!));
      }
    } else if (isReverseCharge(kind)) {
      const own = dec(first.vatPct ?? 0);
      const pct = own.isZero() ? dec(opts.standardPct ?? 0) : own;
      if (pct.isZero()) continue;
      const groupVat = roundMoney(groupAmount.times(pct).dividedBy(100));
      vats = spread(groupVat, amounts, (a) => a.times(pct).dividedBy(100));
      idx.forEach((i, k) => (results[i]!.reverseVat = vats[k]!));
    } else {
      continue;
    }

    const groupVatTotal = sum(vats);
    const groupDeductible = roundMoney(groupVatTotal.times(deductiblePct).dividedBy(100));
    const deductibles = groupVatTotal.isZero()
      ? vats.map(() => dec(0))
      : spread(groupDeductible, vats, (v) => v.times(deductiblePct).dividedBy(100));
    idx.forEach((i, k) => (results[i]!.deductible = deductibles[k]!));
  }

  const net = sum(results.map((r) => r.net));
  const vat = sum(results.map((r) => r.vat));
  return {
    lines: results,
    net,
    vat,
    total: net.plus(vat),
    reverseVat: sum(results.map((r) => r.reverseVat)),
    deductible: sum(results.map((r) => r.deductible)),
  };
}

export type PurchasePostingLine = {
  accountId: string;
  departmentId?: string | null;
  dimensionValueIds?: string[];
  vatRateId?: string | null;
  net: DecimalInput;
  vat: DecimalInput;
  reverseVat: DecimalInput;
  deductible: DecimalInput;
};

export type PurchasePostingRow = {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  departmentId?: string | null;
  dimensionValueIds?: string[];
  vatRateId?: string | null;
  vatAmount?: Decimal | null;
};

/**
 * Ostu kanne eurodes:
 *   D kulu (summa ilma KM-ita + mitte mahaarvatav KM; KM kood ja kogu KM summa KMD jaoks)
 *   D sisendkäibemaks (mahaarvatav osa, KM koodi ostukonto)
 *   K arvestatud käibemaks (pöördmaksustatav KM, KM koodi müügikonto)
 *   K kohustuse konto (tarnijad / aruandvad isikud) – tasakaalustav summa
 * Negatiivne summa (kreeditarve) vahetab poole.
 */
export function buildPurchasePosting(input: {
  payableAccountId: string;
  /** KM kood → { sisend-KM konto, arvestatud KM konto } */
  vatAccounts: Map<string, { input: string | null; output: string | null }>;
  currencyRate: DecimalInput;
  lines: PurchasePostingLine[];
}): PurchasePostingRow[] {
  const rows: PurchasePostingRow[] = [];
  const side = (amount: Decimal) =>
    amount.isNegative() ? { debit: dec(0), credit: amount.negated() } : { debit: amount, credit: dec(0) };

  const expense = new Map<string, { line: PurchasePostingLine; amount: Decimal; vat: Decimal }>();
  const inputVat = new Map<string, Decimal>();
  const outputVat = new Map<string, Decimal>();
  for (const l of input.lines) {
    const key = [l.accountId, l.departmentId ?? "", [...(l.dimensionValueIds ?? [])].sort().join(","), l.vatRateId ?? ""].join("|");
    const totalVat = dec(l.vat).plus(dec(l.reverseVat));
    const cost = dec(l.net).plus(totalVat).minus(dec(l.deductible));
    const prev = expense.get(key);
    expense.set(key, { line: l, amount: (prev?.amount ?? dec(0)).plus(cost), vat: (prev?.vat ?? dec(0)).plus(totalVat) });
    if (l.vatRateId) {
      const accounts = input.vatAccounts.get(l.vatRateId);
      if (!dec(l.deductible).isZero()) {
        if (!accounts?.input) throw new RangeError(`Käibemaksul ${l.vatRateId} puudub sisendkäibemaksu konto`);
        inputVat.set(accounts.input, (inputVat.get(accounts.input) ?? dec(0)).plus(toBase(l.deductible, input.currencyRate)));
      }
      if (!dec(l.reverseVat).isZero()) {
        if (!accounts?.output) throw new RangeError(`Käibemaksul ${l.vatRateId} puudub arvestatud käibemaksu konto`);
        outputVat.set(accounts.output, (outputVat.get(accounts.output) ?? dec(0)).plus(toBase(l.reverseVat, input.currencyRate)));
      }
    }
  }
  for (const { line, amount, vat } of expense.values()) {
    const base = toBase(amount, input.currencyRate);
    if (base.isZero()) continue;
    rows.push({
      accountId: line.accountId,
      ...side(base),
      departmentId: line.departmentId ?? null,
      dimensionValueIds: line.dimensionValueIds ?? [],
      vatRateId: line.vatRateId ?? null,
      vatAmount: line.vatRateId ? toBase(vat, input.currencyRate).abs() : null,
    });
  }
  for (const [accountId, amount] of inputVat) if (!amount.isZero()) rows.push({ accountId, ...side(amount) });
  for (const [accountId, amount] of outputVat) {
    if (!amount.isZero()) rows.push({ accountId, ...side(amount.negated()) });
  }
  const debits = sum(rows.map((r) => r.debit));
  const credits = sum(rows.map((r) => r.credit));
  const payable = debits.minus(credits);
  if (!payable.isZero()) {
    rows.push({
      accountId: input.payableAccountId,
      ...(payable.isNegative() ? { debit: payable.negated(), credit: dec(0) } : { debit: dec(0), credit: payable }),
    });
  }
  return rows;
}
