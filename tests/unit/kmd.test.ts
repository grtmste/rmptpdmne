import { describe, expect, it } from "vitest";
import { dec } from "@/lib/money";
import { buildKmdXml, computeKmd, computeKmdInf, rateLine, sideOf, type KmdInfDocument, type KmdSourceLine } from "@/lib/vat/kmd";

const SEPT = new Date(Date.UTC(2026, 8, 1));

const line = (o: Partial<KmdSourceLine & { documentId: string | null }> & Pick<KmdSourceLine, "side" | "kind">): KmdSourceLine & { documentId: string | null } => ({
  entryId: "e",
  source: o.side === "SALES" ? "SALES_INVOICE" : "PURCHASE_INVOICE",
  sourceId: null,
  ratePct: dec(24),
  standardPct: dec(24),
  deductiblePct: dec(100),
  debit: dec(0),
  credit: dec(0),
  vatAmount: dec(0),
  documentId: null,
  ...o,
});

const v = (r: ReturnType<typeof computeKmd>, code: string) => r.lines.get(code)!.toFixed(2);

describe("KMD read", () => {
  it("määra read vormi kehtivuse järgi", () => {
    expect(rateLine(dec(24), SEPT)).toBe("1");
    expect(rateLine(dec(22), SEPT)).toBe("1²");
    expect(rateLine(dec(13), SEPT)).toBe("2²");
    expect(rateLine(dec(22), new Date(Date.UTC(2025, 5, 1)))).toBe("1");
    expect(rateLine(dec(7), SEPT)).toBeNull();
  });

  it("müük, kreeditarve, null-määrad ja maksuvaba", () => {
    const r = computeKmd(
      [
        line({ side: "SALES", kind: "TAXABLE", credit: dec(1000), vatAmount: dec(240) }),
        line({ side: "SALES", kind: "TAXABLE", debit: dec(100), vatAmount: dec(24) }), // kreeditarve
        line({ side: "SALES", kind: "TAXABLE", ratePct: dec(9), credit: dec(200), vatAmount: dec(18) }),
        line({ side: "SALES", kind: "ZERO_EU_GOODS", ratePct: dec(0), credit: dec(500) }),
        line({ side: "SALES", kind: "EU_SERVICES", ratePct: dec(0), credit: dec(300) }),
        line({ side: "SALES", kind: "ZERO_EXPORT", ratePct: dec(0), credit: dec(50) }),
        line({ side: "SALES", kind: "EXEMPT", ratePct: dec(0), credit: dec(70) }),
        line({ side: "SALES", kind: "REVERSE_CHARGE", credit: dec(400) }),
        line({ side: "SALES", kind: "NOT_TAXABLE", ratePct: dec(0), credit: dec(999) }),
      ],
      { periodStart: SEPT, inputVat: dec(100) },
    );
    expect(v(r, "1")).toBe("900.00");
    expect(v(r, "2")).toBe("200.00");
    expect(v(r, "3")).toBe("850.00");
    expect(v(r, "3.1")).toBe("800.00");
    expect(v(r, "3.1.1")).toBe("500.00");
    expect(v(r, "3.2")).toBe("50.00");
    expect(v(r, "8")).toBe("70.00");
    expect(v(r, "9")).toBe("400.00");
    expect(v(r, "4")).toBe("234.00");
    expect(v(r, "5")).toBe("100.00");
    expect(v(r, "12")).toBe("134.00");
    expect(v(r, "13")).toBe("0.00");
  });

  it("kasuminormi erikord: maksustatav väärtus KM summast", () => {
    // Müük 1000, kasuminorm 248 sh KM 48 → maksustatav väärtus 200
    const r = computeKmd([line({ side: "SALES", kind: "MARGIN", credit: dec(952), vatAmount: dec(48) })], { periodStart: SEPT });
    expect(v(r, "1")).toBe("200.00");
    expect(v(r, "4")).toBe("48.00");
  });

  it("ost: pöördmaksustamine, sõiduauto 50% ja põhivara; enammakse rida 13", () => {
    const r = computeKmd(
      [
        // EL teenus 200, KM 24% pöördmaksuna 48 (täielikult maha arvatav) → kulurida 200
        line({ side: "PURCHASE", kind: "EU_SERVICES", ratePct: dec(0), debit: dec(200), vatAmount: dec(48) }),
        // EL kaup 1000
        line({ side: "PURCHASE", kind: "ZERO_EU_GOODS", ratePct: dec(0), debit: dec(1000), vatAmount: dec(240) }),
        // Siseriiklik § 41¹ soetus 500
        line({ side: "PURCHASE", kind: "REVERSE_CHARGE", debit: dec(500), vatAmount: dec(120) }),
        // Sõiduauto kulu 100 + KM 24, mahaarvatav 12 → kulureal 112
        line({ side: "PURCHASE", kind: "TAXABLE", deductiblePct: dec(50), debit: dec(112), vatAmount: dec(24) }),
        // Põhivara 5000 + KM 1200
        line({ side: "PURCHASE", kind: "TAXABLE", debit: dec(5000), vatAmount: dec(1200), fixedAsset: true }),
      ],
      { periodStart: SEPT },
    );
    expect(v(r, "1")).toBe("1700.00");
    expect(v(r, "4")).toBe("408.00");
    expect(v(r, "6")).toBe("1200.00");
    expect(v(r, "6.1")).toBe("1000.00");
    expect(v(r, "7")).toBe("500.00");
    expect(v(r, "7.1")).toBe("500.00");
    // hinnanguline sisend-KM (kontode käibe puudumisel): 48 + 240 + 120 + 12 + 1200
    expect(v(r, "5")).toBe("1620.00");
    expect(v(r, "5.2")).toBe("1200.00");
    expect(v(r, "5.4")).toBe("12.00");
    expect(v(r, "12")).toBe("0.00");
    expect(v(r, "13")).toBe("1212.00");
  });

  it("müük või ost allika ja konto järgi", () => {
    expect(sideOf("SALES_INVOICE", null, "EXPENSE")).toBe("SALES");
    expect(sideOf("EXPENSE_REPORT", null, "INCOME")).toBe("PURCHASE");
    expect(sideOf("MANUAL", "SALES", "ASSET")).toBe("SALES");
    expect(sideOf("MANUAL", "NONE", "INCOME")).toBe("SALES");
    expect(sideOf("MANUAL", "NONE", "EXPENSE")).toBe("PURCHASE");
  });
});

describe("KMD INF", () => {
  const doc = (id: string, side: "SALES" | "PURCHASE", regCode: string | null, net: string, gross: string): KmdInfDocument => ({
    side,
    documentId: id,
    partnerRegCode: regCode,
    partnerName: `Partner ${regCode ?? id}`,
    invoiceNumber: id,
    invoiceDate: SEPT,
    invoiceNet: dec(net),
    invoiceGross: dec(gross),
  });

  it("piirmäär partneri kohta, eraisikud välja, erisuse koodid", () => {
    const docs = new Map([
      ["A1", doc("A1", "SALES", "10000001", "600", "744")],
      ["A2", doc("A2", "SALES", "10000001", "500", "620")],
      ["A3", doc("A3", "SALES", "10000002", "900", "1116")],
      ["A4", doc("A4", "SALES", null, "5000", "6200")],
      ["A5", doc("A5", "SALES", "10000003", "2000", "2000")],
      ["B1", doc("B1", "PURCHASE", "20000001", "1200", "1488")],
      ["B2", doc("B2", "PURCHASE", "20000002", "1000", "1124")],
    ]);
    const { partA, partB } = computeKmdInf(
      [
        line({ side: "SALES", kind: "TAXABLE", credit: dec(600), vatAmount: dec(144), documentId: "A1" }),
        line({ side: "SALES", kind: "TAXABLE", credit: dec(500), vatAmount: dec(120), documentId: "A2" }),
        line({ side: "SALES", kind: "TAXABLE", credit: dec(900), vatAmount: dec(216), documentId: "A3" }),
        line({ side: "SALES", kind: "TAXABLE", credit: dec(5000), vatAmount: dec(1200), documentId: "A4" }),
        line({ side: "SALES", kind: "REVERSE_CHARGE", credit: dec(2000), documentId: "A5" }),
        line({ side: "PURCHASE", kind: "TAXABLE", debit: dec(1200), vatAmount: dec(288), documentId: "B1" }),
        line({ side: "PURCHASE", kind: "TAXABLE", deductiblePct: dec(50), debit: dec(1062), vatAmount: dec(124), documentId: "B2" }),
      ],
      docs,
      SEPT,
    );
    expect(partA.map((l) => [l.invoiceNumber, l.taxRate, l.sumForRate.toFixed(2), l.comment])).toEqual([
      ["A1", "24", "600.00", null],
      ["A2", "24", "500.00", null],
      ["A5", "0", "2000.00", "01"],
    ]);
    expect(partB.map((l) => [l.invoiceNumber, l.invoiceSum.toFixed(2), l.sumInPeriod.toFixed(2), l.comment])).toEqual([
      ["B1", "1488.00", "288.00", null],
      ["B2", "1124.00", "62.00", "11"],
    ]);
  });

  it("XML sisaldab deklaratsiooni ja lisa ridu", () => {
    const kmd = computeKmd([line({ side: "SALES", kind: "TAXABLE", credit: dec(1000), vatAmount: dec(240) })], { periodStart: SEPT, inputVat: dec(0) });
    const xml = buildKmdXml({
      regCode: "12345678",
      year: 2026,
      month: 9,
      periodStart: SEPT,
      kmd,
      partA: [
        {
          partnerRegCode: "10000001",
          partnerName: "A & B OÜ",
          invoiceNumber: "1001",
          invoiceDate: SEPT,
          invoiceSum: dec(1000),
          taxRate: "24",
          sumForRate: dec(1000),
          sumInPeriod: dec(1000),
          comment: null,
        },
      ],
      partB: [],
    });
    expect(xml).toContain("<taxPayerRegCode>12345678</taxPayerRegCode>");
    expect(xml).toContain("<month>9</month>");
    expect(xml).toContain("<transactions24>1000.00</transactions24>");
    expect(xml).toContain("<noPurchases>true</noPurchases>");
    expect(xml).toContain("<buyerName>A &amp; B OÜ</buyerName>");
    expect(xml).not.toContain("<purchasesAnnex>");
  });
});
