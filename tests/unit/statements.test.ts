import { describe, expect, it } from "vitest";
import { dec } from "@/lib/money";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildIncomeStatement,
  incomeLine2Of,
  profitOf,
  withoutEmptyLines,
  type AccountInfo,
  type Balances,
} from "@/lib/reports/statements";

const acc = (id: string, type: AccountInfo["type"], reportLine: string | null, costFunction: AccountInfo["costFunction"] = null): AccountInfo => ({
  id,
  code: id,
  name: `Konto ${id}`,
  type,
  reportLine,
  costFunction,
});

const ACCOUNTS: AccountInfo[] = [
  acc("1020", "ASSET", "BS_CASH"),
  acc("1200", "ASSET", "BS_ST_RECEIVABLES"),
  acc("1300", "ASSET", "BS_INVENTORIES"),
  acc("1700", "ASSET", "BS_PPE"),
  acc("1790", "ASSET", "BS_PPE"),
  acc("2100", "LIABILITY", "BS_ST_PAYABLES"),
  acc("2500", "LIABILITY", "BS_LT_LOANS"),
  acc("2900", "EQUITY", "BS_SHARE_CAPITAL"),
  acc("2950", "EQUITY", "BS_RETAINED_EARNINGS"),
  acc("3000", "INCOME", "IS_REVENUE"),
  acc("4010", "EXPENSE", "IS_MATERIALS"),
  acc("4100", "EXPENSE", "IS_OTHER_OPEX", "DISTRIBUTION"),
  acc("4200", "EXPENSE", "IS_PERSONNEL"),
  acc("4600", "EXPENSE", "IS_DEPRECIATION"),
  acc("4800", "EXPENSE", "IS_INTEREST_EXPENSE"),
  acc("9999", "EXPENSE", null),
];

const bal = (o: Record<string, string>): Balances => new Map(Object.entries(o).map(([k, v]) => [k, dec(v)]));
const row = (rows: { code: string; amount: { toFixed(n: number): string } }[], code: string) => rows.find((r) => r.code === code)?.amount.toFixed(2);

describe("kasumiaruanne", () => {
  // Käive D − K: tulu kreeditis
  const turnover = bal({ "3000": "-10000", "4010": "3000", "4100": "1000", "4200": "2500", "4600": "500", "4800": "200", "9999": "100" });

  it("skeem 1: tulud positiivsed, kulud negatiivsed, vahesummad", () => {
    const rows = buildIncomeStatement(ACCOUNTS, turnover, null, 1);
    expect(row(rows, "IS_REVENUE")).toBe("10000.00");
    expect(row(rows, "IS_MATERIALS")).toBe("-3000.00");
    // määramata rida → mitmesugused tegevuskulud
    expect(row(rows, "IS_OTHER_OPEX")).toBe("-1100.00");
    expect(row(rows, "IS_OPERATING_PROFIT")).toBe("2900.00");
    expect(row(rows, "IS_PROFIT_BEFORE_TAX")).toBe("2700.00");
    expect(row(rows, "IS_NET_PROFIT")).toBe("2700.00");
    expect(profitOf(ACCOUNTS, turnover).toFixed(2)).toBe("2700.00");
  });

  it("skeem 2: kulud funktsiooni järgi, sama puhaskasum", () => {
    const rows = buildIncomeStatement(ACCOUNTS, turnover, null, 2);
    expect(row(rows, "S2_REVENUE")).toBe("10000.00");
    expect(row(rows, "S2_COST_OF_SALES")).toBe("-3000.00");
    expect(row(rows, "S2_GROSS_PROFIT")).toBe("7000.00");
    expect(row(rows, "S2_DISTRIBUTION")).toBe("-1000.00");
    expect(row(rows, "S2_ADMIN")).toBe("-3100.00");
    expect(row(rows, "IS_OPERATING_PROFIT")).toBe("2900.00");
    expect(row(rows, "IS_NET_PROFIT")).toBe("2700.00");
    expect(incomeLine2Of(acc("x", "EXPENSE", "IS_MATERIALS", "ADMIN"))).toBe("S2_ADMIN");
  });

  it("võrdlusperiood ja tühjade ridade peitmine", () => {
    const rows = buildIncomeStatement(ACCOUNTS, turnover, bal({ "3000": "-8000" }), 1);
    const revenue = rows.find((r) => r.code === "IS_REVENUE")!;
    expect(revenue.compare?.toFixed(2)).toBe("8000.00");
    expect(revenue.accounts.map((a) => a.code)).toEqual(["3000"]);
    const visible = withoutEmptyLines(rows).map((r) => r.code);
    expect(visible).not.toContain("IS_SUBSIDIARIES");
    expect(visible).toContain("IS_NET_PROFIT");
  });
});

describe("bilanss", () => {
  it("varad = kohustised + omakapital koos aruandeaasta kasumiga", () => {
    // Kanded: omakapital 2500 pangas, laen 5000, põhivara 6000 (kulum 500), müük 10000, kulud
    const balances = bal({
      "1020": "4800",
      "1200": "1200",
      "1300": "300",
      "1700": "6000",
      "1790": "-500",
      "2100": "-1600",
      "2500": "-5000",
      "2900": "-2500",
    });
    const rows = buildBalanceSheet(ACCOUNTS, { balances, profit: dec("2700") });
    expect(row(rows, "BS_CURRENT_ASSETS")).toBe("6300.00");
    expect(row(rows, "BS_PPE")).toBe("5500.00");
    expect(row(rows, "BS_TOTAL_ASSETS")).toBe("11800.00");
    expect(row(rows, "BS_TOTAL_LIABILITIES")).toBe("6600.00");
    expect(row(rows, "BS_CURRENT_PROFIT")).toBe("2700.00");
    expect(row(rows, "BS_TOTAL_EQUITY")).toBe("5200.00");
    expect(row(rows, "BS_TOTAL_LIABILITIES_EQUITY")).toBe("11800.00");
  });

  it("võrdlusveerg eelmise aasta lõpu seisuga", () => {
    const rows = buildBalanceSheet(
      ACCOUNTS,
      { balances: bal({ "1020": "100", "2900": "-100" }), profit: dec(0) },
      { balances: bal({ "1020": "50", "2900": "-50" }), profit: dec(0) },
    );
    const cash = rows.find((r) => r.code === "BS_CASH")!;
    expect(cash.compare?.toFixed(2)).toBe("50.00");
    expect(row(rows, "BS_TOTAL_ASSETS")).toBe("100.00");
  });
});

describe("rahavood (kaudne meetod)", () => {
  it("rahavoog = raha saldo muutus", () => {
    // Algus: omakapital 2500 pangas
    const opening = bal({ "1020": "2500", "2900": "-2500" });
    // Periood: müük 10000 (laekumata 1200), ost materjal 3000 + varud 300 (võlg 1600), personal 2500 makstud,
    // põhivara 6000 laenuga 5000, kulum 500, intress 200 makstud, muu kulu 1100 makstud, dividend 400 makstud
    const turnover = bal({ "3000": "-10000", "4010": "3000", "4100": "1000", "4200": "2500", "4600": "500", "4800": "200", "9999": "100" });
    const closing = bal({
      "1020": "4400",
      "1200": "1200",
      "1300": "300",
      "1700": "6000",
      "1790": "-500",
      "2100": "-1600",
      "2500": "-5000",
      "2900": "-2500",
      "2950": "400",
      "3000": "-10000",
      "4010": "3000",
      "4100": "1000",
      "4200": "2500",
      "4600": "500",
      "4800": "200",
      "9999": "100",
    });
    // Kontroll: kanded on tasakaalus
    expect([...closing.values()].reduce((s, v) => s.plus(v), dec(0)).toFixed(2)).toBe("0.00");
    const { rows, difference } = buildCashFlow(ACCOUNTS, opening, closing, turnover);
    expect(row(rows, "CF_OPERATING_PROFIT")).toBe("2900.00");
    expect(row(rows, "CF_DEPRECIATION")).toBe("500.00");
    expect(row(rows, "CF_RECEIVABLES")).toBe("-1200.00");
    expect(row(rows, "CF_INVENTORIES")).toBe("-300.00");
    expect(row(rows, "CF_PAYABLES")).toBe("1600.00");
    expect(row(rows, "CF_FINANCE_ITEMS")).toBe("-200.00");
    expect(row(rows, "CF_FIXED_ASSETS")).toBe("-6000.00");
    expect(row(rows, "CF_LOANS")).toBe("5000.00");
    expect(row(rows, "CF_DIVIDENDS")).toBe("-400.00");
    expect(row(rows, "CF_NET")).toBe("1900.00");
    expect(row(rows, "CF_CASH_OPENING")).toBe("2500.00");
    expect(row(rows, "CF_CASH_CLOSING")).toBe("4400.00");
    expect(difference.toFixed(2)).toBe("0.00");
  });
});
