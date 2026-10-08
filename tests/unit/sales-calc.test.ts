import { describe, expect, it } from "vitest";
import { buildSalesPosting, calculateDocument, lineAmount, spread, toBase } from "@/lib/sales/calc";
import { dec, sum } from "@/lib/money";

const KM = { vatRateId: "km", vatPct: "24", vatKind: "TAXABLE" as const };
const KM9 = { vatRateId: "km9", vatPct: "9", vatKind: "TAXABLE" as const };

describe("rea summa", () => {
  it("kogus × hind × allahindlus, ümardus sentideni", () => {
    expect(lineAmount({ quantity: "3", unitPrice: "19.99" }).toFixed(2)).toBe("59.97");
    expect(lineAmount({ quantity: "1.5", unitPrice: "10.333" }).toFixed(2)).toBe("15.50");
    expect(lineAmount({ quantity: "2", unitPrice: "100", discountPct: "12.5" }).toFixed(2)).toBe("175.00");
    expect(lineAmount({ quantity: "-1", unitPrice: "10.005" }).toFixed(2)).toBe("-10.01");
  });
});

describe("käibemaks dokumendi tasemel", () => {
  it("KM arvutatakse määra kaupa summalt, mitte ridade kaupa", () => {
    // 3 × 0,05 → ridade kaupa 0,01 × 3 = 0,03, dokumendi tasemel 0,15 × 24% = 0,04
    const r = calculateDocument(
      [1, 2, 3].map(() => ({ quantity: "1", unitPrice: "0.05", ...KM })),
      { pricesIncludeVat: false },
    );
    expect(r.vat.toFixed(2)).toBe("0.04");
    expect(sum(r.lines.map((l) => l.vat)).toFixed(2)).toBe("0.04");
    expect(r.total.toFixed(2)).toBe("0.19");
  });

  it("mitu määra ja käibemaksuta rida", () => {
    const r = calculateDocument(
      [
        { quantity: "2", unitPrice: "50", ...KM },
        { quantity: "1", unitPrice: "20", ...KM9 },
        { quantity: "1", unitPrice: "30", vatRateId: "0eks", vatPct: "0", vatKind: "ZERO_EXPORT" },
        { quantity: "1", unitPrice: "10", vatRateId: "pm", vatPct: "24", vatKind: "REVERSE_CHARGE" },
      ],
      { pricesIncludeVat: false },
    );
    expect(r.net.toFixed(2)).toBe("160.00");
    expect(r.vat.toFixed(2)).toBe("25.80");
    expect(r.total.toFixed(2)).toBe("185.80");
    expect(r.vatSummary.map((s) => [s.vatRateId, s.base.toFixed(2), s.vat.toFixed(2)])).toEqual([
      ["km", "100.00", "24.00"],
      ["pm", "10.00", "0.00"],
      ["km9", "20.00", "1.80"],
      ["0eks", "30.00", "0.00"],
    ]);
  });

  it("hinnad sisaldavad käibemaksu", () => {
    const r = calculateDocument(
      [
        { quantity: "1", unitPrice: "12.40", ...KM },
        { quantity: "1", unitPrice: "9.99", ...KM },
      ],
      { pricesIncludeVat: true },
    );
    // 22,39 × 24/124 = 4,3335… → 4,33
    expect(r.vat.toFixed(2)).toBe("4.33");
    expect(r.total.toFixed(2)).toBe("22.39");
    expect(r.net.toFixed(2)).toBe("18.06");
    expect(r.lines.map((l) => l.net.plus(l.vat).toFixed(2))).toEqual(["12.40", "9.99"]);
  });

  it("ettemaksu mahaarvamise rida (vastasmärgiga) samas määras", () => {
    const r = calculateDocument(
      [
        { quantity: "1", unitPrice: "1000", ...KM },
        { quantity: "-1", unitPrice: "300", ...KM },
      ],
      { pricesIncludeVat: false },
    );
    expect(r.vat.toFixed(2)).toBe("168.00");
    expect(r.lines.map((l) => l.vat.toFixed(2))).toEqual(["240.00", "-72.00"]);
  });

  it("nullsummaga määrarühm ei jaga nulliga", () => {
    const r = calculateDocument(
      [
        { quantity: "1", unitPrice: "100", ...KM },
        { quantity: "-1", unitPrice: "100", ...KM },
      ],
      { pricesIncludeVat: false },
    );
    expect(r.total.toFixed(2)).toBe("0.00");
    expect(r.lines.map((l) => l.vat.toFixed(2))).toEqual(["24.00", "-24.00"]);
  });

  it("kreeditarve on negatiivsete kogustega peegelpilt", () => {
    const lines = [
      { quantity: "3", unitPrice: "0.05", ...KM },
      { quantity: "1", unitPrice: "19.99", ...KM9 },
    ];
    const a = calculateDocument(lines, { pricesIncludeVat: false });
    const b = calculateDocument(
      lines.map((l) => ({ ...l, quantity: dec(l.quantity).negated().toString() })),
      { pricesIncludeVat: false },
    );
    expect(b.total.toFixed(2)).toBe(a.total.negated().toFixed(2));
    expect(b.vat.toFixed(2)).toBe(a.vat.negated().toFixed(2));
  });
});

describe("kasuminormi erikord", () => {
  const MARGIN = { vatRateId: "kas", vatPct: "24", vatKind: "MARGIN" as const };

  it("arvel KM puudub, maks juurdehindlusest", () => {
    // Müük 1240, soetus 620 → marginaal 620, KM 620 × 24/124 = 120
    const r = calculateDocument([{ quantity: "1", unitPrice: "1240", unitCost: "620", ...MARGIN }], { pricesIncludeVat: false });
    expect(r.vat.toFixed(2)).toBe("0.00");
    expect(r.total.toFixed(2)).toBe("1240.00");
    expect(r.marginVat.toFixed(2)).toBe("120.00");
  });

  it("negatiivne juurdehindlus maksu ei vähenda", () => {
    const r = calculateDocument(
      [
        { quantity: "1", unitPrice: "1240", unitCost: "620", ...MARGIN },
        { quantity: "1", unitPrice: "100", unitCost: "300", ...MARGIN },
      ],
      { pricesIncludeVat: false },
    );
    expect(r.marginVat.toFixed(2)).toBe("120.00");
    expect(r.lines.map((l) => l.marginVat.toFixed(2))).toEqual(["120.00", "0.00"]);
  });

  it("kreeditarvel väheneb maks", () => {
    const r = calculateDocument([{ quantity: "-1", unitPrice: "1240", unitCost: "620", ...MARGIN }], { pricesIncludeVat: false });
    expect(r.marginVat.toFixed(2)).toBe("-120.00");
    expect(r.total.toFixed(2)).toBe("-1240.00");
  });
});

describe("jaotus", () => {
  it("spread annab täpselt kogusumma", () => {
    const parts = spread("0.04", ["0.05", "0.05", "0.05"], (w) => w.times("0.24"));
    expect(sum(parts).toFixed(2)).toBe("0.04");
  });
});

describe("kanne", () => {
  const vatAccounts = new Map([
    ["km", "acc2300"],
    ["kas", "acc2300"],
  ]);

  it("D nõuded, K tulu ja K käibemaks; KM kood ja summa tulureal", () => {
    const calc = calculateDocument(
      [
        { quantity: "2", unitPrice: "50", ...KM },
        { quantity: "1", unitPrice: "30", vatRateId: "0eks", vatPct: "0", vatKind: "ZERO_EXPORT" },
      ],
      { pricesIncludeVat: false },
    );
    const rows = buildSalesPosting({
      receivableAccountId: "acc1200",
      vatAccounts,
      currencyRate: "1",
      lines: [
        { accountId: "acc3000", vatRateId: "km", ...calc.lines[0]! },
        { accountId: "acc3040", vatRateId: "0eks", ...calc.lines[1]! },
      ],
    });
    const simple = rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2), r.vatAmount?.toFixed(2) ?? null]);
    expect(simple).toEqual([
      ["acc1200", "154.00", "0.00", null],
      ["acc3000", "0.00", "100.00", "24.00"],
      ["acc3040", "0.00", "30.00", "0.00"],
      ["acc2300", "0.00", "24.00", null],
    ]);
  });

  it("kreeditarve vahetab pooled", () => {
    const calc = calculateDocument([{ quantity: "-1", unitPrice: "100", ...KM }], { pricesIncludeVat: false });
    const rows = buildSalesPosting({
      receivableAccountId: "acc1200",
      vatAccounts,
      currencyRate: "1",
      lines: [{ accountId: "acc3000", vatRateId: "km", ...calc.lines[0]! }],
    });
    expect(rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2)])).toEqual([
      ["acc1200", "0.00", "124.00"],
      ["acc3000", "100.00", "0.00"],
      ["acc2300", "24.00", "0.00"],
    ]);
  });

  it("kasuminormi erikord: tulu ilma maksuta, maks KM kontole", () => {
    const calc = calculateDocument(
      [{ quantity: "1", unitPrice: "1240", unitCost: "620", vatRateId: "kas", vatPct: "24", vatKind: "MARGIN" }],
      { pricesIncludeVat: false },
    );
    const rows = buildSalesPosting({
      receivableAccountId: "acc1200",
      vatAccounts,
      currencyRate: "1",
      lines: [{ accountId: "acc3000", vatRateId: "kas", ...calc.lines[0]! }],
    });
    expect(rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2), r.vatAmount?.toFixed(2) ?? null])).toEqual([
      ["acc1200", "1240.00", "0.00", null],
      ["acc3000", "0.00", "1120.00", "120.00"],
      ["acc2300", "0.00", "120.00", null],
    ]);
  });

  it("valuutaarve teisendatakse eurodeks ja on tasakaalus", () => {
    const calc = calculateDocument(
      [
        { quantity: "1", unitPrice: "333.33", ...KM },
        { quantity: "1", unitPrice: "100", ...KM },
      ],
      { pricesIncludeVat: false },
    );
    const rows = buildSalesPosting({
      receivableAccountId: "acc1200",
      vatAccounts,
      currencyRate: "1.0853",
      lines: calc.lines.map((l) => ({ accountId: "acc3000", vatRateId: "km", ...l })),
    });
    const debit = sum(rows.map((r) => r.debit));
    const credit = sum(rows.map((r) => r.credit));
    expect(debit.toFixed(2)).toBe(credit.toFixed(2));
    expect(rows[1]!.credit.toFixed(2)).toBe(toBase("433.33", "1.0853").toFixed(2));
  });
});
