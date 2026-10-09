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

describe("saldoteatise PDF", () => {
  it("meeldetuletus ja saldoteatis kinnitusosaga", async () => {
    const { renderStatementPdf } = await import("@/server/pdf/statement-document");
    const base = {
      accent: "#0f5c55",
      company: { name: "Põhjatuul AS", address: "Õie 1, Tartu", regCode: "12345678", email: "info@pt.ee", phone: null, bankDetails: "EE38 2200 2210 2014 5685" },
      customer: { name: "ООО Ромашка", regCode: null, address: null },
      meta: [["Seisuga", "10.05.2026"]] as Array<[string, string]>,
      intro: "Meie andmetel on tasumata järgmised arved.",
      rows: [{ number: "1001", date: "01.04.2026", dueDate: "15.04.2026", total: "1 240,00", open: "500,00", overdue: "25 p" }],
      totals: [["Tasumata kokku", "500,00"]] as Array<[string, string]>,
      payable: ["Tasuda", "500,00 EUR"] as [string, string],
      labels: Object.fromEntries(["buyer", "regCode", "number", "date", "dueDate", "total", "open", "overdue", "bank", "page"].map((k) => [k, k])) as never,
    };
    const reminder = await renderStatementPdf({ ...base, title: "MAKSEMEELDETULETUS", confirmation: null });
    expect(reminder.subarray(0, 4).toString()).toBe("%PDF");
    const statement = await renderStatementPdf({
      ...base,
      title: "SALDOTEATIS",
      confirmation: { text: "Palun kinnitage saldo.", agree: "Kinnitame", disagree: "Ei kinnita", signature: "Allkiri" },
    });
    expect(statement.length).toBeGreaterThan(reminder.length);
  });
});
