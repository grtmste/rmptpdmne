import { describe, expect, it } from "vitest";
import { renderSalesDocumentPdf, type PdfDocumentData } from "@/server/pdf/sales-document";

const labels = Object.fromEntries(
  ["seller", "buyer", "regCode", "vatNumber", "code", "description", "quantity", "unit", "price", "discount", "vat", "amount", "bank", "page"].map(
    (k) => [k, k],
  ),
) as PdfDocumentData["labels"];

describe("PDF", () => {
  it("arve PDF eesti ja vene tähtedega", async () => {
    const buffer = await renderSalesDocumentPdf({
      title: "Arve",
      number: "1001",
      accent: "#0f5c55",
      company: {
        name: "Põhjatuul AS",
        regCode: "12345678",
        vatNumber: "EE123456789",
        address: "Õie 1, Tartu",
        email: "arved@pohjatuul.ee",
        phone: null,
        website: null,
        bankDetails: "LHV EE717700771001234567",
        footer: "Täname!",
      },
      customer: { name: "ООО Ромашка", regCode: null, vatNumber: null, address: "Москва" },
      meta: [["Kuupäev", "08.10.2026"]],
      lines: Array.from({ length: 60 }, (_, i) => ({
        code: `A${i}`,
        description: `Šokolaad ja žele – строка ${i}`,
        quantity: "1",
        unit: "tk",
        unitPrice: "10,00",
        discount: null,
        vat: "24%",
        amount: "10,00",
      })),
      showDiscount: false,
      vatSummary: [["KM 24% alus", "600,00"]],
      totals: [["Summa", "600,00"]],
      payable: ["Tasuda", "744,00 EUR"],
      notes: ["Märkus"],
      labels,
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(5000);
  }, 30_000);
});
