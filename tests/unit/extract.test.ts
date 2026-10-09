import { describe, expect, it } from "vitest";
import { extractInvoiceData, guessVatPct, parseAmount } from "@/lib/purchases/extract";

const ESTONIAN = `
Taimla Puukool OÜ
Reg. kood: 10987654
KMKR nr EE100987654
Pank: Swedbank EE38 2200 2210 2014 5685

ARVE nr TP-2291
Arve kuupäev: 05.10.2026
Maksetähtaeg: 19.10.2026
Viitenumber: 22918

Ostja: Lilleaed OÜ, reg. kood 16000001, KMKR EE102000001
Konto EE71 7700 7710 0173 5865

Roosipõõsas   40 tk   9,20   368,00
Summa KM-ta                 368,00
Käibemaks 24%                88,32
Kokku tasuda             456,32 EUR
`;

describe("ostuarve tuvastus", () => {
  it("eesti arve sildid", () => {
    const r = extractInvoiceData(ESTONIAN, { regCode: "16000001", vatNumber: "EE102000001", ibans: ["EE717700771001735865"] });
    expect(r.invoiceNumber).toBe("TP-2291");
    expect(r.date).toBe("2026-10-05");
    expect(r.dueDate).toBe("2026-10-19");
    expect(r.referenceNumber).toBe("22918");
    expect(r.net).toBe("368.00");
    expect(r.vat).toBe("88.32");
    expect(r.total).toBe("456.32");
    expect(r.regCodes).toEqual(["10987654"]);
    expect(r.vatNumbers).toEqual(["EE100987654"]);
    expect(r.ibans).toEqual(["EE382200221020145685"]);
    expect(r.currency).toBe("EUR");
  });

  it("inglise arve ja summa vormingud", () => {
    const r = extractInvoiceData(`Invoice No: INV-2026/118\nInvoice date 2026-09-30\nDue date 14/10/2026\nSubtotal 1,200.00\nVAT 288.00\nTotal due EUR 1,488.00`);
    expect([r.invoiceNumber, r.date, r.dueDate, r.net, r.vat, r.total]).toEqual(["INV-2026/118", "2026-09-30", "2026-10-14", "1200.00", "288.00", "1488.00"]);
  });

  it("summad ja KM määr", () => {
    expect(parseAmount("1 234,56")).toBe("1234.56");
    expect(parseAmount("1.234,5")).toBe("1234.50");
    expect(parseAmount("1,234")).toBe("1234.00");
    expect(parseAmount("88,32")).toBe("88.32");
    expect(guessVatPct("368.00", "88.32")).toBe(24);
    expect(guessVatPct("100", "9")).toBe(9);
    expect(guessVatPct("100", "17")).toBeNull();
  });

  it("tühi tekst (skaneeritud pilt)", () => {
    const r = extractInvoiceData("");
    expect(r.invoiceNumber).toBeNull();
    expect(r.total).toBeNull();
    expect(r.regCodes).toEqual([]);
  });
});
