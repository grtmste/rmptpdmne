import type Decimal from "decimal.js";
import { dec, roundMoney, sum, type DecimalInput } from "@/lib/money";

/**
 * Müügidokumendi (arve, pakkumine) summade arvutus – ainus koht, kus arve summad tekivad.
 *
 * Reeglid (CLAUDE.md p 6.4):
 * - rea summa = kogus × ühikuhind × (1 − allahindlus %), ümardatud sentideni;
 * - käibemaks arvutatakse määra kaupa dokumendi tasemel (rea summade summalt) ja jaotatakse
 *   ridadele nii, et ridade KM summa on täpselt dokumendi KM (vajalik pearaamatu ja KMD jaoks);
 * - „hinnad sisaldavad KM-i“ korral eraldatakse KM brutosummast;
 * - KM-i arvestatakse ainult maksustatavalt käibelt (TAXABLE). 0%, EL, maksuvaba, pöördmaksustamine
 *   jt on arvel 0;
 * - kasuminormi erikorra (MARGIN) real on hind käibemaksuga, arvel KM-i ei näidata; maks
 *   arvutatakse juurdehindlusest (müügihind − soetusmaksumus) valemiga marginaal × m / (100 + m).
 *   Negatiivne juurdehindlus maksu ei vähenda.
 */

export type VatKindLike =
  | "TAXABLE"
  | "ZERO_EXPORT"
  | "ZERO_EU_GOODS"
  | "EU_SERVICES"
  | "EXEMPT"
  | "REVERSE_CHARGE"
  | "NOT_TAXABLE"
  | "MARGIN";

export type CalcLine = {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  discountPct?: DecimalInput | null;
  /** Käibemaksu kood (rühmitamiseks); null = käibemaksuta rida */
  vatRateId?: string | null;
  vatPct?: DecimalInput | null;
  vatKind?: VatKindLike | null;
  /** Kasuminormi erikorra soetusmaksumus ühiku kohta */
  unitCost?: DecimalInput | null;
};

export type CalcLineResult = {
  /** Rea summa hinnas, nagu kasutaja selle sisestas (KM-ga või KM-ta) */
  amount: Decimal;
  /** Summa ilma käibemaksuta (arvel näidatav) */
  net: Decimal;
  /** Arvel näidatav käibemaks */
  vat: Decimal;
  /** Kasuminormi erikorra käibemaks (arvel ei näidata, sisaldub net-is) */
  marginVat: Decimal;
};

export type VatSummaryRow = {
  vatRateId: string | null;
  vatPct: Decimal;
  kind: VatKindLike | null;
  base: Decimal;
  vat: Decimal;
};

export type CalcResult = {
  lines: CalcLineResult[];
  net: Decimal;
  vat: Decimal;
  total: Decimal;
  marginVat: Decimal;
  vatSummary: VatSummaryRow[];
};

/** Rea summa hinnas: kogus × hind × (1 − allahindlus/100), ümardatud. */
export function lineAmount(line: Pick<CalcLine, "quantity" | "unitPrice" | "discountPct">): Decimal {
  const discount = dec(line.discountPct ?? 0);
  return roundMoney(dec(line.quantity).times(dec(line.unitPrice)).times(dec(100).minus(discount)).dividedBy(100));
}

/**
 * Jaotab grupi summa ridadele: iga rida saab oma osa ümardatult, ümardusvahe läheb suurima
 * absoluutväärtusega reale. Erinevalt `allocate`-ist sobib ka vastasmärgiliste ridade korral
 * (nt lõpparve ettemaksu mahaarvamise rida).
 */
export function spread(total: DecimalInput, weights: DecimalInput[], rate: (w: Decimal) => Decimal): Decimal[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => dec(x));
  const parts = w.map((x) => roundMoney(rate(x)));
  const diff = roundMoney(total).minus(sum(parts));
  if (!diff.isZero()) {
    let idx = 0;
    w.forEach((x, i) => {
      if (x.abs().greaterThan(w[idx]!.abs())) idx = i;
    });
    parts[idx] = parts[idx]!.plus(diff);
  }
  return parts;
}

const taxable = (kind: VatKindLike | null | undefined) => kind === "TAXABLE";

export function calculateDocument(lines: CalcLine[], opts: { pricesIncludeVat: boolean }): CalcResult {
  const results: CalcLineResult[] = lines.map((l) => {
    const amount = lineAmount(l);
    return { amount, net: amount, vat: dec(0), marginVat: dec(0) };
  });

  // Rühmad käibemaksu koodi ja määra järgi (sama kood võib kreeditarvel olla eri määraga)
  const groups = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const key = `${l.vatRateId ?? ""}|${dec(l.vatPct ?? 0).toFixed(2)}|${l.vatKind ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });

  const vatSummary: VatSummaryRow[] = [];
  for (const idx of groups.values()) {
    const first = lines[idx[0]!]!;
    const pct = dec(first.vatPct ?? 0);
    const kind = first.vatKind ?? null;
    const amounts = idx.map((i) => results[i]!.amount);
    const groupAmount = sum(amounts);

    if (kind === "MARGIN") {
      // Hind sisaldab maksu, arvel KM 0; maks juurdehindlusest
      const margins = idx.map((i) => {
        const l = lines[i]!;
        const cost = roundMoney(dec(l.quantity).times(dec(l.unitCost ?? 0)));
        const m = results[i]!.amount.minus(cost);
        // Kreeditarvel (negatiivne kogus) on marginaal negatiivne ja vähendab maksu
        return results[i]!.amount.isNegative() ? (m.isPositive() ? dec(0) : m) : m.isNegative() ? dec(0) : m;
      });
      const marginTotal = sum(margins);
      const groupVat = roundMoney(marginTotal.times(pct).dividedBy(pct.plus(100)));
      const parts = marginTotal.isZero()
        ? idx.map(() => dec(0))
        : spread(groupVat, margins, (m) => m.times(pct).dividedBy(pct.plus(100)));
      idx.forEach((i, k) => (results[i]!.marginVat = parts[k]!));
      vatSummary.push({ vatRateId: first.vatRateId ?? null, vatPct: pct, kind, base: groupAmount, vat: dec(0) });
      continue;
    }

    if (!taxable(kind) || pct.isZero()) {
      vatSummary.push({ vatRateId: first.vatRateId ?? null, vatPct: pct, kind, base: groupAmount, vat: dec(0) });
      continue;
    }

    if (opts.pricesIncludeVat) {
      const groupVat = roundMoney(groupAmount.times(pct).dividedBy(pct.plus(100)));
      const parts = spread(groupVat, amounts, (a) => a.times(pct).dividedBy(pct.plus(100)));
      idx.forEach((i, k) => {
        results[i]!.vat = parts[k]!;
        results[i]!.net = results[i]!.amount.minus(parts[k]!);
      });
      vatSummary.push({ vatRateId: first.vatRateId ?? null, vatPct: pct, kind, base: groupAmount.minus(groupVat), vat: groupVat });
    } else {
      const groupVat = roundMoney(groupAmount.times(pct).dividedBy(100));
      const parts = spread(groupVat, amounts, (a) => a.times(pct).dividedBy(100));
      idx.forEach((i, k) => (results[i]!.vat = parts[k]!));
      vatSummary.push({ vatRateId: first.vatRateId ?? null, vatPct: pct, kind, base: groupAmount, vat: groupVat });
    }
  }

  const net = sum(results.map((r) => r.net));
  const vat = sum(results.map((r) => r.vat));
  return {
    lines: results,
    net,
    vat,
    total: net.plus(vat),
    marginVat: sum(results.map((r) => r.marginVat)),
    vatSummary: vatSummary.sort((a, b) => b.vatPct.comparedTo(a.vatPct)),
  };
}

/** Teisendab valuutasumma eurodeks (1 EUR = rate valuutat). */
export function toBase(amount: DecimalInput, rate: DecimalInput): Decimal {
  const r = dec(rate);
  if (r.isZero() || r.isNegative()) throw new RangeError("Valuutakurss peab olema positiivne");
  return roundMoney(dec(amount).dividedBy(r));
}

export type PostingLine = {
  accountId: string;
  departmentId?: string | null;
  dimensionValueIds?: string[];
  vatRateId?: string | null;
  net: DecimalInput;
  vat: DecimalInput;
  marginVat: DecimalInput;
};

export type PostingInput = {
  receivableAccountId: string;
  /** Käibemaksu kood → arvestatud KM konto */
  vatAccounts: Map<string, string>;
  currencyRate: DecimalInput;
  lines: PostingLine[];
  description?: string;
};

export type PostingRow = {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  departmentId?: string | null;
  dimensionValueIds?: string[];
  vatRateId?: string | null;
  vatAmount?: Decimal | null;
};

/**
 * Müügiarve kanne eurodes:
 *   D ostjate nõuded (kogusumma)
 *   K tulu- või ettemakse kontod (rea summa ilma KM-ita, rühmitatud konto/osakonna/dimensioonide/KM järgi)
 *   K arvestatud käibemaks (KM koodi kaupa)
 * Tulurida kannab KM koodi ja summat (KMD alus). Negatiivne summa (kreeditarve) vahetab poole.
 * Valuutaarvel teisendatakse read eurodeks ja nõue on ridade summa, et kanne oleks tasakaalus.
 */
export function buildSalesPosting(input: PostingInput): PostingRow[] {
  const rows: PostingRow[] = [];
  const side = (amount: Decimal) =>
    amount.isNegative() ? { debit: amount.negated(), credit: dec(0) } : { debit: dec(0), credit: amount };

  const revenue = new Map<string, { line: PostingLine; amount: Decimal; vat: Decimal }>();
  const vatByRate = new Map<string, Decimal>();
  for (const l of input.lines) {
    const key = [l.accountId, l.departmentId ?? "", [...(l.dimensionValueIds ?? [])].sort().join(","), l.vatRateId ?? ""].join("|");
    const net = dec(l.net).minus(dec(l.marginVat));
    const vat = dec(l.vat).plus(dec(l.marginVat));
    const prev = revenue.get(key);
    revenue.set(key, { line: l, amount: (prev?.amount ?? dec(0)).plus(net), vat: (prev?.vat ?? dec(0)).plus(vat) });
    if (l.vatRateId && !vat.isZero()) vatByRate.set(l.vatRateId, (vatByRate.get(l.vatRateId) ?? dec(0)).plus(vat));
  }

  for (const { line, amount, vat } of revenue.values()) {
    const base = toBase(amount, input.currencyRate);
    if (base.isZero()) continue;
    rows.push({
      accountId: line.accountId,
      ...side(base),
      departmentId: line.departmentId ?? null,
      dimensionValueIds: line.dimensionValueIds ?? [],
      vatRateId: line.vatRateId ?? null,
      // KM summa märk järgib rea poolt (vt JournalLineInput.vatAmount)
      vatAmount: line.vatRateId ? toBase(vat, input.currencyRate).abs() : null,
    });
  }
  // Käibemaksu read konto kaupa (mitu määra võib kasutada sama kontot)
  const vatByAccount = new Map<string, Decimal>();
  for (const [vatRateId, vat] of vatByRate) {
    const account = input.vatAccounts.get(vatRateId);
    if (!account) throw new RangeError(`Käibemaksul ${vatRateId} puudub arvestatud KM konto`);
    vatByAccount.set(account, (vatByAccount.get(account) ?? dec(0)).plus(toBase(vat, input.currencyRate)));
  }
  for (const [accountId, base] of vatByAccount) {
    if (!base.isZero()) rows.push({ accountId, ...side(base) });
  }
  const credits = sum(rows.map((r) => r.credit));
  const debits = sum(rows.map((r) => r.debit));
  const receivable = credits.minus(debits);
  if (receivable.isZero()) return rows;
  rows.unshift({
    accountId: input.receivableAccountId,
    ...(receivable.isNegative() ? { debit: dec(0), credit: receivable.negated() } : { debit: receivable, credit: dec(0) }),
  });
  return rows;
}

/** Maksetähtaeg: kuupäev + päevad (UTC kuupäevad). */
export function dueDateFrom(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
