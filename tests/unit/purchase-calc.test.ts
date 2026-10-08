import { describe, expect, it } from "vitest";
import { buildPurchasePosting, calculatePurchase } from "@/lib/purchases/calc";
import { sum } from "@/lib/money";

const KM = { vatRateId: "km", vatPct: "24", vatKind: "TAXABLE" as const };
const vatAccounts = new Map([
  ["km", { input: "2310", output: "2300" }],
  ["auto", { input: "2310", output: "2300" }],
  ["elt", { input: "2310", output: "2300" }],
  ["pm", { input: "2310", output: "2300" }],
]);

const simple = (rows: ReturnType<typeof buildPurchasePosting>) =>
  rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2), r.vatAmount?.toFixed(2) ?? null]);

describe("ostuarve summad", () => {
  it("maksustatav ost: KM määra kaupa, kogu KM maha arvatav", () => {
    const r = calculatePurchase(
      [
        { quantity: "1", unitPrice: "100", ...KM },
        { quantity: "2", unitPrice: "0.05", ...KM },
      ],
      { pricesIncludeVat: false },
    );
    expect(r.net.toFixed(2)).toBe("100.10");
    expect(r.vat.toFixed(2)).toBe("24.02");
    expect(r.deductible.toFixed(2)).toBe("24.02");
    expect(r.total.toFixed(2)).toBe("124.12");
  });

  it("hinnad KM-ga (tšekk)", () => {
    const r = calculatePurchase([{ quantity: "1", unitPrice: "12.40", ...KM }], { pricesIncludeVat: true });
    expect(r.net.toFixed(2)).toBe("10.00");
    expect(r.vat.toFixed(2)).toBe("2.40");
    expect(r.total.toFixed(2)).toBe("12.40");
  });

  it("sõiduauto: 50% KM-ist maha, ülejäänu kulusse", () => {
    const r = calculatePurchase([{ quantity: "1", unitPrice: "100.01", vatRateId: "auto", vatPct: "24", vatKind: "TAXABLE", deductiblePct: "50" }], {
      pricesIncludeVat: false,
    });
    expect(r.vat.toFixed(2)).toBe("24.00");
    expect(r.deductible.toFixed(2)).toBe("12.00");
    const rows = buildPurchasePosting({
      payableAccountId: "2110",
      vatAccounts,
      currencyRate: "1",
      lines: [{ accountId: "4125", vatRateId: "auto", ...r.lines[0]! }],
    });
    expect(simple(rows)).toEqual([
      ["4125", "112.01", "0.00", "24.00"],
      ["2310", "12.00", "0.00", null],
      ["2110", "0.00", "124.01", null],
    ]);
  });

  it("EL teenus: tarnija arvel KM-i pole, ostja arvestab standardmääraga", () => {
    const r = calculatePurchase([{ quantity: "1", unitPrice: "200", vatRateId: "elt", vatPct: "0", vatKind: "EU_SERVICES" }], {
      pricesIncludeVat: false,
      standardPct: "24",
    });
    expect(r.total.toFixed(2)).toBe("200.00");
    expect(r.reverseVat.toFixed(2)).toBe("48.00");
    expect(r.deductible.toFixed(2)).toBe("48.00");
    const rows = buildPurchasePosting({
      payableAccountId: "2110",
      vatAccounts,
      currencyRate: "1",
      lines: [{ accountId: "4150", vatRateId: "elt", ...r.lines[0]! }],
    });
    expect(simple(rows)).toEqual([
      ["4150", "200.00", "0.00", "48.00"],
      ["2310", "48.00", "0.00", null],
      ["2300", "0.00", "48.00", null],
      ["2110", "0.00", "200.00", null],
    ]);
  });

  it("siseriiklik pöördmaksustamine kasutab koodi enda määra", () => {
    const r = calculatePurchase([{ quantity: "1", unitPrice: "1000", vatRateId: "pm", vatPct: "24", vatKind: "REVERSE_CHARGE" }], {
      pricesIncludeVat: false,
      standardPct: "22",
    });
    expect(r.reverseVat.toFixed(2)).toBe("240.00");
    expect(r.vat.toFixed(2)).toBe("0.00");
  });

  it("maksuvaba ja käibemaksuta read", () => {
    const r = calculatePurchase(
      [
        { quantity: "1", unitPrice: "50", vatRateId: "mv", vatPct: "0", vatKind: "EXEMPT" },
        { quantity: "1", unitPrice: "5" },
      ],
      { pricesIncludeVat: false, standardPct: "24" },
    );
    expect(r.total.toFixed(2)).toBe("55.00");
    expect(r.deductible.toFixed(2)).toBe("0.00");
  });

  it("kreeditarve vahetab kande pooled", () => {
    const r = calculatePurchase([{ quantity: "-1", unitPrice: "100", ...KM }], { pricesIncludeVat: false });
    const rows = buildPurchasePosting({
      payableAccountId: "2110",
      vatAccounts,
      currencyRate: "1",
      lines: [{ accountId: "4190", vatRateId: "km", ...r.lines[0]! }],
    });
    expect(simple(rows)).toEqual([
      ["4190", "0.00", "100.00", "24.00"],
      ["2310", "0.00", "24.00", null],
      ["2110", "124.00", "0.00", null],
    ]);
  });

  it("valuutaarve kanne on tasakaalus", () => {
    const r = calculatePurchase(
      [
        { quantity: "3", unitPrice: "33.33", ...KM },
        { quantity: "1", unitPrice: "17.77", ...KM },
      ],
      { pricesIncludeVat: false },
    );
    const rows = buildPurchasePosting({
      payableAccountId: "2110",
      vatAccounts,
      currencyRate: "1.0857",
      lines: r.lines.map((l) => ({ accountId: "4190", vatRateId: "km", ...l })),
    });
    expect(sum(rows.map((x) => x.debit)).toFixed(2)).toBe(sum(rows.map((x) => x.credit)).toFixed(2));
  });
});
