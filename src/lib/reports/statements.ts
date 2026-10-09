import type Decimal from "decimal.js";
import { dec } from "@/lib/money";

/**
 * Finantsaruannete koostamine kontode saldodest (puhtad funktsioonid, testitavad ilma andmebaasita).
 *
 * Bilanss ja kasumiaruanne järgivad Raamatupidamise seaduse lisade 1 ja 2 lühendatud vorme;
 * konto seotakse reaga GlAccount.reportLine kaudu (src/lib/accounting/report-lines.ts).
 * Rahavoogude aruanne on kaudsel meetodil ja tuletatakse bilansiridade muutustest.
 */

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type CostFunction = "COST_OF_SALES" | "DISTRIBUTION" | "ADMIN";

export type AccountInfo = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  reportLine: string | null;
  costFunction?: CostFunction | null;
};

/** Saldo märgiga: deebet − kreedit. */
export type Balances = Map<string, Decimal>;

export type StatementRow = {
  code: string;
  kind: "heading" | "line" | "subtotal" | "total";
  amount: Decimal;
  compare: Decimal | null;
  accounts: Array<{ id: string; code: string; name: string; amount: Decimal; compare: Decimal | null }>;
};

type Layout = Array<{ code: string; kind: StatementRow["kind"]; sum?: string[] }>;

const zero = () => dec(0);

// --- Bilanss ---------------------------------------------------------------

const ASSET_CURRENT = ["BS_CASH", "BS_ST_INVESTMENTS", "BS_ST_RECEIVABLES", "BS_INVENTORIES", "BS_ST_BIOLOGICAL", "BS_HELD_FOR_SALE"];
const ASSET_NONCURRENT = ["BS_LT_INVESTMENTS", "BS_SUBSIDIARIES", "BS_LT_RECEIVABLES", "BS_INVESTMENT_PROPERTY", "BS_PPE", "BS_LT_BIOLOGICAL", "BS_INTANGIBLES"];
const LIAB_CURRENT = ["BS_ST_LOANS", "BS_ST_PAYABLES", "BS_ST_PROVISIONS", "BS_ST_GRANTS"];
const LIAB_NONCURRENT = ["BS_LT_LOANS", "BS_LT_PAYABLES", "BS_LT_PROVISIONS", "BS_LT_GRANTS"];
const EQUITY = [
  "BS_SHARE_CAPITAL",
  "BS_UNREGISTERED_CAPITAL",
  "BS_UNPAID_CAPITAL",
  "BS_SHARE_PREMIUM",
  "BS_TREASURY_SHARES",
  "BS_STATUTORY_RESERVE",
  "BS_OTHER_RESERVES",
  "BS_RETAINED_EARNINGS",
  "BS_CURRENT_PROFIT",
];

const lines = (codes: string[]) => codes.map((code) => ({ code, kind: "line" as const }));

export const BALANCE_LAYOUT: Layout = [
  { code: "BS_ASSETS", kind: "heading" },
  { code: "BS_CURRENT_ASSETS_H", kind: "heading" },
  ...lines(ASSET_CURRENT),
  { code: "BS_CURRENT_ASSETS", kind: "subtotal", sum: ASSET_CURRENT },
  { code: "BS_NONCURRENT_ASSETS_H", kind: "heading" },
  ...lines(ASSET_NONCURRENT),
  { code: "BS_NONCURRENT_ASSETS", kind: "subtotal", sum: ASSET_NONCURRENT },
  { code: "BS_TOTAL_ASSETS", kind: "total", sum: [...ASSET_CURRENT, ...ASSET_NONCURRENT] },
  { code: "BS_LIABILITIES_EQUITY", kind: "heading" },
  { code: "BS_CURRENT_LIABILITIES_H", kind: "heading" },
  ...lines(LIAB_CURRENT),
  { code: "BS_CURRENT_LIABILITIES", kind: "subtotal", sum: LIAB_CURRENT },
  { code: "BS_NONCURRENT_LIABILITIES_H", kind: "heading" },
  ...lines(LIAB_NONCURRENT),
  { code: "BS_NONCURRENT_LIABILITIES", kind: "subtotal", sum: LIAB_NONCURRENT },
  { code: "BS_TOTAL_LIABILITIES", kind: "subtotal", sum: [...LIAB_CURRENT, ...LIAB_NONCURRENT] },
  { code: "BS_EQUITY_H", kind: "heading" },
  ...lines(EQUITY),
  { code: "BS_TOTAL_EQUITY", kind: "subtotal", sum: EQUITY },
  { code: "BS_TOTAL_LIABILITIES_EQUITY", kind: "total", sum: [...LIAB_CURRENT, ...LIAB_NONCURRENT, ...EQUITY] },
];

const BALANCE_FALLBACK: Record<"ASSET" | "LIABILITY" | "EQUITY", string> = {
  ASSET: "BS_ST_RECEIVABLES",
  LIABILITY: "BS_ST_PAYABLES",
  EQUITY: "BS_OTHER_RESERVES",
};
const BALANCE_CODES = new Set([...ASSET_CURRENT, ...ASSET_NONCURRENT, ...LIAB_CURRENT, ...LIAB_NONCURRENT, ...EQUITY]);

/** Bilansikonto rida; puuduva või sobimatu rea korral tüübi järgi vaikimisi rida. */
export function balanceLineOf(a: AccountInfo): string | null {
  if (a.type === "INCOME" || a.type === "EXPENSE") return null;
  return a.reportLine && BALANCE_CODES.has(a.reportLine) ? a.reportLine : BALANCE_FALLBACK[a.type];
}

/**
 * Bilansi read. `balances` – bilansikontode saldod (D − K) seisuga; `profit` – aruandeaasta
 * tulem seisuga (tulude ja kulude saldod, K − D), mis läheb reale „Aruandeaasta kasum (kahjum)“.
 * Varad näidatakse deebetsaldona, kohustised ja omakapital kreeditsaldona.
 */
export function buildBalanceSheet(
  accounts: AccountInfo[],
  current: { balances: Balances; profit: Decimal },
  compare?: { balances: Balances; profit: Decimal } | null,
) {
  const sign = (a: AccountInfo) => (a.type === "ASSET" ? 1 : -1);
  const entries = accounts.flatMap((a) => {
    const line = balanceLineOf(a);
    if (!line) return [];
    const amount = (current.balances.get(a.id) ?? zero()).times(sign(a));
    const prev = compare ? (compare.balances.get(a.id) ?? zero()).times(sign(a)) : null;
    if (amount.isZero() && (!prev || prev.isZero())) return [];
    return [{ line, account: a, amount, compare: prev }];
  });
  const extra = new Map<string, { amount: Decimal; compare: Decimal | null }>([
    ["BS_CURRENT_PROFIT", { amount: current.profit, compare: compare ? compare.profit : null }],
  ]);
  return assemble(BALANCE_LAYOUT, entries, extra, Boolean(compare));
}

// --- Kasumiaruanne ---------------------------------------------------------

const OPERATING_1 = [
  "IS_REVENUE",
  "IS_OTHER_INCOME",
  "IS_INVENTORY_CHANGE",
  "IS_CAPITALISED_COSTS",
  "IS_MATERIALS",
  "IS_OTHER_OPEX",
  "IS_PERSONNEL",
  "IS_DEPRECIATION",
  "IS_CURRENT_ASSET_WRITEDOWN",
  "IS_OTHER_EXPENSES",
];
const FINANCE = ["IS_SUBSIDIARIES", "IS_ASSOCIATES", "IS_BIOLOGICAL", "IS_FIN_INVESTMENTS", "IS_INTEREST_INCOME", "IS_INTEREST_EXPENSE", "IS_OTHER_FINANCE"];
const TAX = ["IS_INCOME_TAX"];

export const INCOME_LAYOUT_1: Layout = [
  ...lines(OPERATING_1),
  { code: "IS_OPERATING_PROFIT", kind: "subtotal", sum: OPERATING_1 },
  ...lines(FINANCE),
  { code: "IS_PROFIT_BEFORE_TAX", kind: "subtotal", sum: [...OPERATING_1, ...FINANCE] },
  ...lines(TAX),
  { code: "IS_NET_PROFIT", kind: "total", sum: [...OPERATING_1, ...FINANCE, ...TAX] },
];

const OPERATING_2 = ["S2_REVENUE", "S2_COST_OF_SALES", "S2_DISTRIBUTION", "S2_ADMIN", "S2_OTHER_INCOME", "S2_OTHER_EXPENSES"];

export const INCOME_LAYOUT_2: Layout = [
  { code: "S2_REVENUE", kind: "line" },
  { code: "S2_COST_OF_SALES", kind: "line" },
  { code: "S2_GROSS_PROFIT", kind: "subtotal", sum: ["S2_REVENUE", "S2_COST_OF_SALES"] },
  ...lines(["S2_DISTRIBUTION", "S2_ADMIN", "S2_OTHER_INCOME", "S2_OTHER_EXPENSES"]),
  { code: "IS_OPERATING_PROFIT", kind: "subtotal", sum: OPERATING_2 },
  ...lines(FINANCE),
  { code: "IS_PROFIT_BEFORE_TAX", kind: "subtotal", sum: [...OPERATING_2, ...FINANCE] },
  ...lines(TAX),
  { code: "IS_NET_PROFIT", kind: "total", sum: [...OPERATING_2, ...FINANCE, ...TAX] },
];

const INCOME_CODES = new Set([...OPERATING_1, ...FINANCE, ...TAX]);

/** Kasumiaruande skeemi 1 rida; puuduva rea korral muud äritulud / mitmesugused tegevuskulud. */
export function incomeLineOf(a: AccountInfo): string | null {
  if (a.type !== "INCOME" && a.type !== "EXPENSE") return null;
  if (a.reportLine && INCOME_CODES.has(a.reportLine)) return a.reportLine;
  return a.type === "INCOME" ? "IS_OTHER_INCOME" : "IS_OTHER_OPEX";
}

/** Kulu vaikimisi funktsioon skeemis 2: materjalid müüdud toodangu kulusse, ülejäänu üldhalduskuludesse. */
export function defaultCostFunction(line: string): CostFunction {
  return line === "IS_MATERIALS" ? "COST_OF_SALES" : "ADMIN";
}

const FUNCTION_LINE: Record<CostFunction, string> = { COST_OF_SALES: "S2_COST_OF_SALES", DISTRIBUTION: "S2_DISTRIBUTION", ADMIN: "S2_ADMIN" };

/** Skeemi 2 rida (kulude funktsiooni järgi). */
export function incomeLine2Of(a: AccountInfo): string | null {
  const line = incomeLineOf(a);
  if (!line) return null;
  switch (line) {
    case "IS_REVENUE":
      return "S2_REVENUE";
    case "IS_OTHER_INCOME":
      return "S2_OTHER_INCOME";
    case "IS_OTHER_EXPENSES":
      return "S2_OTHER_EXPENSES";
    case "IS_INVENTORY_CHANGE":
    case "IS_CAPITALISED_COSTS":
      return "S2_COST_OF_SALES";
    case "IS_MATERIALS":
    case "IS_OTHER_OPEX":
    case "IS_PERSONNEL":
    case "IS_DEPRECIATION":
    case "IS_CURRENT_ASSET_WRITEDOWN":
      return FUNCTION_LINE[a.costFunction ?? defaultCostFunction(line)];
    default:
      return line;
  }
}

/**
 * Kasumiaruanne perioodi käibest (`turnover`: D − K konto kaupa). Summad K − D: tulud
 * positiivsed, kulud negatiivsed, nagu aruandevormil.
 */
export function buildIncomeStatement(accounts: AccountInfo[], turnover: Balances, compare: Balances | null, scheme: 1 | 2) {
  const lineOf = scheme === 1 ? incomeLineOf : incomeLine2Of;
  const entries = accounts.flatMap((a) => {
    const line = lineOf(a);
    if (!line) return [];
    const amount = (turnover.get(a.id) ?? zero()).negated();
    const prev = compare ? (compare.get(a.id) ?? zero()).negated() : null;
    if (amount.isZero() && (!prev || prev.isZero())) return [];
    return [{ line, account: a, amount, compare: prev }];
  });
  return assemble(scheme === 1 ? INCOME_LAYOUT_1 : INCOME_LAYOUT_2, entries, new Map(), Boolean(compare));
}

/** Tulude ja kulude kontode tulem (K − D). */
export function profitOf(accounts: AccountInfo[], balances: Balances): Decimal {
  return accounts
    .filter((a) => a.type === "INCOME" || a.type === "EXPENSE")
    .reduce((s, a) => s.minus(balances.get(a.id) ?? zero()), zero());
}

// --- Rahavood (kaudne meetod) ----------------------------------------------

export const CASH_FLOW_LAYOUT: Layout = [
  { code: "CF_OPERATING_H", kind: "heading" },
  { code: "CF_OPERATING_PROFIT", kind: "line" },
  { code: "CF_DEPRECIATION", kind: "line" },
  { code: "CF_RECEIVABLES", kind: "line" },
  { code: "CF_INVENTORIES", kind: "line" },
  { code: "CF_PAYABLES", kind: "line" },
  { code: "CF_FINANCE_ITEMS", kind: "line" },
  { code: "CF_INCOME_TAX", kind: "line" },
  { code: "CF_OPERATING", kind: "subtotal", sum: ["CF_OPERATING_PROFIT", "CF_DEPRECIATION", "CF_RECEIVABLES", "CF_INVENTORIES", "CF_PAYABLES", "CF_FINANCE_ITEMS", "CF_INCOME_TAX"] },
  { code: "CF_INVESTING_H", kind: "heading" },
  { code: "CF_FIXED_ASSETS", kind: "line" },
  { code: "CF_INVESTMENTS", kind: "line" },
  { code: "CF_INVESTING", kind: "subtotal", sum: ["CF_FIXED_ASSETS", "CF_INVESTMENTS"] },
  { code: "CF_FINANCING_H", kind: "heading" },
  { code: "CF_LOANS", kind: "line" },
  { code: "CF_EQUITY", kind: "line" },
  { code: "CF_DIVIDENDS", kind: "line" },
  { code: "CF_FINANCING", kind: "subtotal", sum: ["CF_LOANS", "CF_EQUITY", "CF_DIVIDENDS"] },
  {
    code: "CF_NET",
    kind: "total",
    sum: ["CF_OPERATING_PROFIT", "CF_DEPRECIATION", "CF_RECEIVABLES", "CF_INVENTORIES", "CF_PAYABLES", "CF_FINANCE_ITEMS", "CF_INCOME_TAX", "CF_FIXED_ASSETS", "CF_INVESTMENTS", "CF_LOANS", "CF_EQUITY", "CF_DIVIDENDS"],
  },
  { code: "CF_CASH_OPENING", kind: "line" },
  { code: "CF_CASH_CLOSING", kind: "line" },
];

/** Bilansirea saldo (varad D − K, kohustised ja omakapital K − D) kontode saldodest. */
function byBalanceLine(accounts: AccountInfo[], balances: Balances) {
  const out = new Map<string, Decimal>();
  for (const a of accounts) {
    const line = balanceLineOf(a);
    if (!line) continue;
    const v = (balances.get(a.id) ?? zero()).times(a.type === "ASSET" ? 1 : -1);
    out.set(line, (out.get(line) ?? zero()).plus(v));
  }
  return out;
}

/**
 * Rahavoogude aruanne perioodi kohta. `opening`/`closing` – kõigi kontode saldod (D − K) perioodi
 * alguse eelõhtu ja lõpu seisuga, sh tulude-kulude kontod kumulatiivselt (nii sisaldab omakapitali
 * muutus kogu tulemit); `turnover` – perioodi käive (kasumiaruande read).
 *
 * Iga bilansirida kuulub täpselt ühte rahavoo ritta, seega kehtib alati
 * CF_NET = raha lõppsaldo − raha algsaldo (eeldusel, et kanded on tasakaalus).
 */
export function buildCashFlow(accounts: AccountInfo[], opening: Balances, closing: Balances, turnover: Balances) {
  const o = byBalanceLine(accounts, opening);
  const c = byBalanceLine(accounts, closing);
  const delta = (codes: string[]) => codes.reduce((s, code) => s.plus((c.get(code) ?? zero()).minus(o.get(code) ?? zero())), zero());
  const pnlLine = (codes: string[]) =>
    accounts.filter((a) => codes.includes(incomeLineOf(a) ?? "")).reduce((s, a) => s.minus(turnover.get(a.id) ?? zero()), zero());

  const operatingProfit = pnlLine(OPERATING_1);
  const depreciation = pnlLine(["IS_DEPRECIATION"]).negated();
  const financeItems = pnlLine(FINANCE);
  const incomeTax = pnlLine(TAX);
  const netProfit = operatingProfit.plus(financeItems).plus(incomeTax);
  // Tulude ja kulude kontod on bilansis omakapitali osa (jaotamata kasum + aruandeaasta tulem)
  const pnlEquity = (b: Balances) => profitOf(accounts, b);
  const retainedDelta = delta(["BS_RETAINED_EARNINGS", "BS_CURRENT_PROFIT"]).plus(pnlEquity(closing)).minus(pnlEquity(opening));

  const values = new Map<string, Decimal>([
    ["CF_OPERATING_PROFIT", operatingProfit],
    ["CF_DEPRECIATION", depreciation],
    ["CF_RECEIVABLES", delta(["BS_ST_RECEIVABLES", "BS_LT_RECEIVABLES"]).negated()],
    ["CF_INVENTORIES", delta(["BS_INVENTORIES", "BS_ST_BIOLOGICAL"]).negated()],
    ["CF_PAYABLES", delta([...LIAB_CURRENT, ...LIAB_NONCURRENT].filter((x) => x !== "BS_ST_LOANS" && x !== "BS_LT_LOANS"))],
    ["CF_FINANCE_ITEMS", financeItems],
    ["CF_INCOME_TAX", incomeTax],
    ["CF_FIXED_ASSETS", delta(["BS_PPE", "BS_INTANGIBLES", "BS_INVESTMENT_PROPERTY", "BS_LT_BIOLOGICAL"]).plus(depreciation).negated()],
    ["CF_INVESTMENTS", delta(["BS_ST_INVESTMENTS", "BS_HELD_FOR_SALE", "BS_LT_INVESTMENTS", "BS_SUBSIDIARIES"]).negated()],
    ["CF_LOANS", delta(["BS_ST_LOANS", "BS_LT_LOANS"])],
    ["CF_EQUITY", delta(EQUITY.filter((x) => x !== "BS_RETAINED_EARNINGS" && x !== "BS_CURRENT_PROFIT"))],
    ["CF_DIVIDENDS", retainedDelta.minus(netProfit)],
    ["CF_CASH_OPENING", o.get("BS_CASH") ?? zero()],
    ["CF_CASH_CLOSING", c.get("BS_CASH") ?? zero()],
  ]);
  const rows: StatementRow[] = CASH_FLOW_LAYOUT.map((l) => ({
    code: l.code,
    kind: l.kind,
    amount: l.sum ? l.sum.reduce((s, code) => s.plus(values.get(code) ?? zero()), zero()) : (values.get(l.code) ?? zero()),
    compare: null,
    accounts: [],
  }));
  const net = rows.find((r) => r.code === "CF_NET")!.amount;
  const cashChange = values.get("CF_CASH_CLOSING")!.minus(values.get("CF_CASH_OPENING")!);
  return { rows, difference: cashChange.minus(net) };
}

// --- Ühine -----------------------------------------------------------------

function assemble(
  layout: Layout,
  entries: Array<{ line: string; account: AccountInfo; amount: Decimal; compare: Decimal | null }>,
  extra: Map<string, { amount: Decimal; compare: Decimal | null }>,
  withCompare: boolean,
) {
  const lineTotals = new Map<string, { amount: Decimal; compare: Decimal }>();
  const add = (line: string, amount: Decimal, compare: Decimal | null) => {
    const cur = lineTotals.get(line) ?? { amount: zero(), compare: zero() };
    lineTotals.set(line, { amount: cur.amount.plus(amount), compare: cur.compare.plus(compare ?? 0) });
  };
  for (const e of entries) add(e.line, e.amount, e.compare);
  for (const [line, v] of extra) add(line, v.amount, v.compare);

  const rows: StatementRow[] = layout.map((l) => {
    if (l.kind === "heading") return { code: l.code, kind: l.kind, amount: zero(), compare: null, accounts: [] };
    const codes = l.sum ?? [l.code];
    const amount = codes.reduce((s, code) => s.plus(lineTotals.get(code)?.amount ?? 0), zero());
    const compare = withCompare ? codes.reduce((s, code) => s.plus(lineTotals.get(code)?.compare ?? 0), zero()) : null;
    const accounts =
      l.kind === "line"
        ? entries
            .filter((e) => e.line === l.code)
            .sort((a, b) => a.account.code.localeCompare(b.account.code))
            .map((e) => ({ id: e.account.id, code: e.account.code, name: e.account.name, amount: e.amount, compare: e.compare }))
        : [];
    return { code: l.code, kind: l.kind, amount, compare, accounts };
  });
  return rows;
}

/** Peidab tühjad read (summa ja võrdlus null, kontosid pole); vahesummad ja päised jäävad. */
export function withoutEmptyLines(rows: StatementRow[]) {
  return rows.filter((r) => r.kind !== "line" || !r.amount.isZero() || (r.compare && !r.compare.isZero()) || r.accounts.length > 0);
}
