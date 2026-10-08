import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import {
  confirmExpenseReport,
  confirmPurchase,
  createPurchaseCredit,
  createUploadDraft,
  deletePurchaseDraft,
  orderToPurchaseInvoice,
  savePurchaseDraft,
  savePurchaseOrder,
  saveExpenseReport,
} from "@/server/services/purchases";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let otherCompanyId: string;
let userId: string;
let supplierId: string;
const acc: Record<string, string> = {};
const vat: Record<string, string> = {};

async function ledgerLines(source: "PURCHASE_INVOICE" | "EXPENSE_REPORT", id: string) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { companyId, source, sourceId: id },
    include: { lines: { include: { account: true }, orderBy: { sortOrder: "asc" } } },
  });
  return entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2), l.vatAmount?.toFixed(2) ?? null]);
}

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "ost@test.ee",
    name: "Ostja",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  const mk = (name: string) =>
    createCompanyForUser(db, user.id, organization.id, { name, regCode: null, vatNumber: null, accountingStartDate: d("2026-01-01") });
  companyId = (await mk("Ost OÜ")).id;
  otherCompanyId = (await mk("Võõras OÜ")).id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  for (const v of await db.vatRate.findMany({ where: { companyId } })) vat[v.code] = v.id;
  supplierId = (
    await db.supplier.create({
      data: { companyId, name: "Kontoritarbed AS", regCode: "12345678", bankAccount: "EE382200221020145685", defaultAccountId: acc["4140"] },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("ostuarve", () => {
  let invoiceId: string;

  it("mustand kasutab tarnija vaikimisi kulukontot ja IBAN-i", async () => {
    invoiceId = await db.$transaction((tx) =>
      savePurchaseDraft(tx, companyId, userId, {
        supplierId,
        invoiceNumber: "A-77",
        date: d("2026-03-05"),
        pricesIncludeVat: false,
        lines: [
          { description: "Paber", quantity: "10", unitPrice: "4.50", vatRateId: vat.KM },
          { description: "Kütus", quantity: "1", unitPrice: "100", vatRateId: vat.AUTO50, accountId: acc["4125"] },
        ],
      }),
    );
    const inv = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    expect(inv.lines[0]!.accountId).toBe(acc["4140"]);
    expect(inv.bankAccount).toBe("EE382200221020145685");
    expect(inv.total.toFixed(2)).toBe("179.80");
    expect(inv.lines[1]!.deductibleVat.toFixed(2)).toBe("12.00");
  });

  it("kinnitamine: D kulud, D sisend-KM (sõiduauto 50%), K võlad tarnijatele", async () => {
    const res = await db.$transaction((tx) => confirmPurchase(tx, companyId, userId, invoiceId));
    expect(res.number).toBe("OA-1");
    expect(await ledgerLines("PURCHASE_INVOICE", invoiceId)).toEqual([
      ["4140", "45.00", "0.00", "10.80"],
      ["4125", "112.00", "0.00", "24.00"],
      ["2310", "22.80", "0.00", null],
      ["2110", "0.00", "179.80", null],
    ]);
  });

  it("sama tarnija sama arve numbrit ei saa kaks korda kinnitada", async () => {
    const dup = await db.$transaction((tx) =>
      savePurchaseDraft(tx, companyId, userId, {
        supplierId,
        invoiceNumber: "A-77",
        date: d("2026-03-06"),
        pricesIncludeVat: false,
        lines: [{ description: "x", quantity: "1", unitPrice: "1" }],
      }),
    );
    await expect(db.$transaction((tx) => confirmPurchase(tx, companyId, userId, dup))).rejects.toMatchObject({ code: "duplicateInvoiceNumber" });
    await db.$transaction((tx) => deletePurchaseDraft(tx, companyId, dup));
  });

  it("EL teenuse pöördmaksustamine: KM ostja poolt, võlg ilma KM-ita", async () => {
    const id = await db.$transaction((tx) =>
      savePurchaseDraft(tx, companyId, userId, {
        supplierId,
        invoiceNumber: "EU-1",
        date: d("2026-03-10"),
        pricesIncludeVat: false,
        lines: [{ description: "Tarkvara litsents", quantity: "1", unitPrice: "200", vatRateId: vat.ELT, accountId: acc["4150"] }],
      }),
    );
    await db.$transaction((tx) => confirmPurchase(tx, companyId, userId, id));
    expect(await ledgerLines("PURCHASE_INVOICE", id)).toEqual([
      ["4150", "200.00", "0.00", "48.00"],
      ["2310", "48.00", "0.00", null],
      ["2300", "0.00", "48.00", null],
      ["2110", "0.00", "200.00", null],
    ]);
  });

  it("kreeditarve vahetab pooled", async () => {
    const creditId = await db.$transaction((tx) => createPurchaseCredit(tx, companyId, userId, invoiceId, d("2026-03-20")));
    await db.$transaction((tx) =>
      savePurchaseDraft(tx, companyId, userId, {
        id: creditId,
        supplierId,
        invoiceNumber: "KR-1",
        date: d("2026-03-20"),
        pricesIncludeVat: false,
        lines: [{ description: "Paber tagasi", quantity: "-2", unitPrice: "4.50", vatRateId: vat.KM, accountId: acc["4140"] }],
      }),
    );
    await db.$transaction((tx) => confirmPurchase(tx, companyId, userId, creditId));
    expect(await ledgerLines("PURCHASE_INVOICE", creditId)).toEqual([
      ["4140", "0.00", "9.00", "2.16"],
      ["2310", "0.00", "2.16", null],
      ["2110", "11.16", "0.00", null],
    ]);
  });

  it("üleslaaditud mustand vajab enne kinnitamist tarnijat ja arve numbrit", async () => {
    const id = await db.$transaction((tx) => createUploadDraft(tx, companyId, userId, d("2026-04-01")));
    const inv = await db.purchaseInvoice.findUniqueOrThrow({ where: { id } });
    expect(inv.source).toBe("UPLOAD");
    await expect(db.$transaction((tx) => confirmPurchase(tx, companyId, userId, id))).rejects.toMatchObject({ code: "supplierRequired" });
    await db.$transaction((tx) =>
      savePurchaseDraft(tx, companyId, userId, {
        id,
        supplierId,
        date: d("2026-04-01"),
        pricesIncludeVat: false,
        lines: [{ description: "Toonerid", quantity: "1", unitPrice: "80", vatRateId: vat.KM }],
      }),
    );
    await expect(db.$transaction((tx) => confirmPurchase(tx, companyId, userId, id))).rejects.toMatchObject({ code: "invoiceNumberRequired" });
  });
});

describe("ostutellimus", () => {
  it("tellimusest saab ostuarve mustandi", async () => {
    const orderId = await db.$transaction((tx) =>
      savePurchaseOrder(tx, companyId, userId, {
        supplierId,
        date: d("2026-05-02"),
        pricesIncludeVat: false,
        lines: [{ description: "Printer", quantity: "1", unitPrice: "300", vatRateId: vat.KM }],
      }),
    );
    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.number).toBe("T-1");
    expect(order.total.toFixed(2)).toBe("372.00");
    const invoiceId = await db.$transaction((tx) => orderToPurchaseInvoice(tx, companyId, userId, orderId, d("2026-05-10")));
    const inv = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.total.toFixed(2)).toBe("372.00");
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("INVOICED");
    await db.$transaction((tx) => deletePurchaseDraft(tx, companyId, invoiceId));
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("RECEIVED");
  });
});

describe("kuluaruanne", () => {
  it("tšekkide KM eraldatakse brutosummast ja võlg on aruandvale isikule", async () => {
    const employee = await db.employee.create({ data: { companyId, name: "Mari Maasikas" } });
    const id = await db.$transaction((tx) =>
      saveExpenseReport(tx, companyId, userId, {
        employeeId: employee.id,
        date: d("2026-06-30"),
        description: "Juuni kulud",
        lines: [
          { date: d("2026-06-03"), vendor: "Rimi", description: "Kohvioad", grossAmount: "12.40", vatRateId: vat.KM, accountId: acc["4190"] },
          { date: d("2026-06-15"), vendor: "Hotell", description: "Majutus", grossAmount: "113.00", vatRateId: vat.KM13, accountId: acc["4130"] },
          { date: d("2026-06-20"), description: "Parkimine", grossAmount: "3", accountId: acc["4120"] },
        ],
      }),
    );
    const report = await db.expenseReport.findUniqueOrThrow({ where: { id } });
    expect(report.total.toFixed(2)).toBe("128.40");
    expect(report.vatTotal.toFixed(2)).toBe("15.40");
    const res = await db.$transaction((tx) => confirmExpenseReport(tx, companyId, userId, id));
    expect(res.number).toBe("KA-1");
    expect(await ledgerLines("EXPENSE_REPORT", id)).toEqual([
      ["4190", "10.00", "0.00", "2.40"],
      ["4130", "100.00", "0.00", "13.00"],
      ["4120", "3.00", "0.00", null],
      ["2310", "15.40", "0.00", null],
      ["2410", "0.00", "128.40", null],
    ]);
  });
});

describe("ettevõtete eraldatus", () => {
  it("teise ettevõtte tarnijat ega arvet ei saa kasutada", async () => {
    await expect(
      db.$transaction((tx) =>
        savePurchaseDraft(tx, otherCompanyId, userId, {
          supplierId,
          date: d("2026-03-05"),
          pricesIncludeVat: false,
          lines: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "supplierNotFound" });
    const inv = await db.purchaseInvoice.findFirstOrThrow({ where: { companyId } });
    await expect(db.$transaction((tx) => confirmPurchase(tx, otherCompanyId, userId, inv.id))).rejects.toMatchObject({ code: "invoiceNotFound" });
  });
});
