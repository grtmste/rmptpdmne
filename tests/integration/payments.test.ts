import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { confirmInvoice, saveInvoiceDraft } from "@/server/services/sales";
import { confirmPurchase, savePurchaseDraft } from "@/server/services/purchases";
import { cancelPayment, confirmPayment, openItems, savePayment } from "@/server/services/payments";
import { confirmStatementLine, createPaymentOrder, importStatement, markPaymentOrderPaid, paymentOrderXml } from "@/server/services/bank";
import { dec } from "@/lib/money";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let userId: string;
let bankId: string;
let customerId: string;
let supplierId: string;
const acc: Record<string, string> = {};
const vat: Record<string, string> = {};

async function ledger(paymentId: string) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { companyId, source: "PAYMENT", sourceId: paymentId, reversalOfId: null },
    include: { lines: { include: { account: true }, orderBy: { sortOrder: "asc" } } },
  });
  return entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)]);
}

async function salesInvoice(total: string, date = "2026-03-01", currency?: string) {
  return db.$transaction(async (tx) => {
    const id = await saveInvoiceDraft(tx, companyId, userId, {
      type: "INVOICE",
      customerId,
      date: d(date),
      pricesIncludeVat: true,
      currency,
      lines: [{ description: "Teenus", quantity: "1", unitPrice: total, vatRateId: vat.KM }],
    });
    await confirmInvoice(tx, companyId, userId, id);
    return id;
  });
}

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "makse@test.ee",
    name: "Maksja",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyId = (await createCompanyForUser(db, user.id, organization.id, { name: "Maksed OÜ", regCode: "12345678", vatNumber: null, accountingStartDate: d("2026-01-01") })).id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  for (const v of await db.vatRate.findMany({ where: { companyId } })) vat[v.code] = v.id;
  const bank = await db.bankAccount.findFirstOrThrow({ where: { companyId, kind: "BANK" } });
  bankId = (await db.bankAccount.update({ where: { id: bank.id }, data: { iban: "EE382200221020145685" } })).id;
  customerId = (await db.customer.create({ data: { companyId, name: "Kohvik Roheline OÜ" } })).id;
  supplierId = (await db.supplier.create({ data: { companyId, name: "Sidefirma AS", bankAccount: "EE471000001020145685" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("laekumised", () => {
  it("vaikimisi pangakonto ja kassa on loodud", async () => {
    const accounts = await db.bankAccount.findMany({ where: { companyId }, orderBy: { sortOrder: "asc" } });
    expect(accounts.map((a) => a.kind)).toEqual(["BANK", "CASH"]);
  });

  it("osaline laekumine ja seejärel jääk; arve tasutud summa uueneb", async () => {
    const invoiceId = await salesInvoice("124");
    const p1 = await db.$transaction(async (tx) => {
      const id = await savePayment(tx, companyId, userId, {
        direction: "IN",
        bankAccountId: bankId,
        date: d("2026-03-10"),
        amount: "100",
        partyType: "CUSTOMER",
        customerId,
        allocations: [{ type: "SALES_INVOICE", salesInvoiceId: invoiceId, amount: "100" }],
      });
      await confirmPayment(tx, companyId, userId, id);
      return id;
    });
    expect(await ledger(p1)).toEqual([
      ["1020", "100.00", "0.00"],
      ["1200", "0.00", "100.00"],
    ]);
    expect((await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidTotal.toFixed(2)).toBe("100.00");
    const open = await openItems(db, companyId, { types: ["SALES_INVOICE"], customerId });
    expect(open.map((o) => o.open)).toEqual(["24.00"]);

    // Ülemaks ei ole lubatud
    await expect(
      db.$transaction(async (tx) => {
        const id = await savePayment(tx, companyId, userId, {
          direction: "IN",
          bankAccountId: bankId,
          date: d("2026-03-11"),
          amount: "30",
          partyType: "CUSTOMER",
          customerId,
          allocations: [{ type: "SALES_INVOICE", salesInvoiceId: invoiceId, amount: "30" }],
        });
        await confirmPayment(tx, companyId, userId, id);
      }),
    ).rejects.toMatchObject({ code: "overpaid" });

    // Jääk + ülejääk ettemaksuks
    const p2 = await db.$transaction(async (tx) => {
      const id = await savePayment(tx, companyId, userId, {
        direction: "IN",
        bankAccountId: bankId,
        date: d("2026-03-12"),
        amount: "30",
        partyType: "CUSTOMER",
        customerId,
        allocations: [
          { type: "SALES_INVOICE", salesInvoiceId: invoiceId, amount: "24" },
          { type: "PREPAYMENT", amount: "6" },
        ],
      });
      await confirmPayment(tx, companyId, userId, id);
      return id;
    });
    expect(await ledger(p2)).toEqual([
      ["1020", "30.00", "0.00"],
      ["1200", "0.00", "24.00"],
      ["2500", "0.00", "6.00"],
    ]);
    expect((await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidTotal.toFixed(2)).toBe("124.00");

    // Tühistamine pöörab kande ja vabastab arve
    await db.$transaction((tx) => cancelPayment(tx, companyId, userId, p2, d("2026-03-13")));
    expect((await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidTotal.toFixed(2)).toBe("100.00");
    expect(await db.journalEntry.count({ where: { companyId, source: "PAYMENT", sourceId: p2, reversalOfId: { not: null } } })).toBe(1);
  });

  it("summa peab klappima sidumistega", async () => {
    const invoiceId = await salesInvoice("50");
    await expect(
      db.$transaction(async (tx) => {
        const id = await savePayment(tx, companyId, userId, {
          direction: "IN",
          bankAccountId: bankId,
          date: d("2026-03-20"),
          amount: "60",
          partyType: "CUSTOMER",
          customerId,
          allocations: [{ type: "SALES_INVOICE", salesInvoiceId: invoiceId, amount: "50" }],
        });
        await confirmPayment(tx, companyId, userId, id);
      }),
    ).rejects.toMatchObject({ code: "allocationMismatch" });
  });

  it("valuutaarve laekumise kursivahe", async () => {
    await db.companyCurrency.create({ data: { companyId, code: "USD" } });
    await db.exchangeRate.createMany({
      data: [
        { currency: "USD", date: d("2026-04-01"), rate: "1.25" },
        { currency: "USD", date: d("2026-04-20"), rate: "1.20" },
      ],
    });
    const usdBank = await db.bankAccount.create({ data: { companyId, name: "USD konto", currency: "USD", accountId: acc["1020"]! } });
    const invoiceId = await salesInvoice("1000", "2026-04-01", "USD");
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.totalBase.toFixed(2)).toBe("800.00");
    const p = await db.$transaction(async (tx) => {
      const id = await savePayment(tx, companyId, userId, {
        direction: "IN",
        bankAccountId: usdBank.id,
        date: d("2026-04-20"),
        amount: "1000",
        partyType: "CUSTOMER",
        customerId,
        allocations: [{ type: "SALES_INVOICE", salesInvoiceId: invoiceId, amount: "1000" }],
      });
      await confirmPayment(tx, companyId, userId, id);
      return id;
    });
    expect(await ledger(p)).toEqual([
      ["1020", "833.33", "0.00"],
      ["1200", "0.00", "800.00"],
      ["3810", "0.00", "33.33"],
    ]);
  });
});

describe("väljamaksed ja tasaarveldus", () => {
  let purchaseId: string;

  it("ostuarve tasumine koos pangatasuga", async () => {
    purchaseId = await db.$transaction(async (tx) => {
      const id = await savePurchaseDraft(tx, companyId, userId, {
        supplierId,
        invoiceNumber: "S-1",
        date: d("2026-05-01"),
        pricesIncludeVat: false,
        lines: [{ description: "Internet", quantity: "1", unitPrice: "40", vatRateId: vat.KM, accountId: acc["4150"] }],
      });
      await confirmPurchase(tx, companyId, userId, id);
      return id;
    });
    const p = await db.$transaction(async (tx) => {
      const id = await savePayment(tx, companyId, userId, {
        direction: "OUT",
        bankAccountId: bankId,
        date: d("2026-05-05"),
        amount: "30.20",
        partyType: "SUPPLIER",
        supplierId,
        allocations: [
          { type: "PURCHASE_INVOICE", purchaseInvoiceId: purchaseId, amount: "30" },
          { type: "ACCOUNT", accountId: acc["4180"], amount: "0.20", description: "Teenustasu" },
        ],
      });
      await confirmPayment(tx, companyId, userId, id);
      return id;
    });
    expect(await ledger(p)).toEqual([
      ["1020", "0.00", "30.20"],
      ["2110", "30.00", "0.00"],
      ["4180", "0.20", "0.00"],
    ]);
  });

  it("tasaarveldus kliendi ja tarnija vahel ning väikesaldo mahakandmine", async () => {
    const salesId = await salesInvoice("19.60", "2026-05-02");
    const p = await db.$transaction(async (tx) => {
      const id = await savePayment(tx, companyId, userId, {
        direction: "NETTING",
        date: d("2026-05-31"),
        amount: "0",
        partyType: "OTHER",
        partyName: "Sidefirma AS / Kohvik",
        allocations: [
          { type: "SALES_INVOICE", salesInvoiceId: salesId, amount: "19.60" },
          { type: "PURCHASE_INVOICE", purchaseInvoiceId: purchaseId, amount: "19.60" },
        ],
      });
      await confirmPayment(tx, companyId, userId, id);
      return id;
    });
    expect(await ledger(p)).toEqual([
      ["1200", "0.00", "19.60"],
      ["2110", "19.60", "0.00"],
    ]);
    const purchase = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(dec(purchase.total).minus(purchase.paidTotal).toFixed(2)).toBe("0.00");
  });
});


describe("pangaväljavõte", () => {
  it("import, sobitamine viitenumbri ja IBAN-i järgi, topeltimpordi vältimine", async () => {
    const invoiceId = await salesInvoice("62", "2026-06-01");
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const purchaseId = await db.$transaction(async (tx) => {
      const id = await savePurchaseDraft(tx, companyId, userId, {
        supplierId,
        invoiceNumber: "S-777",
        date: d("2026-06-01"),
        pricesIncludeVat: false,
        lines: [{ description: "Mobiil", quantity: "1", unitPrice: "10", vatRateId: vat.KM, accountId: acc["4150"] }],
      });
      await confirmPurchase(tx, companyId, userId, id);
      return id;
    });
    const statement = {
      externalId: "ST1",
      iban: "EE382200221020145685",
      currency: "EUR",
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      openingBalance: null,
      closingBalance: null,
      entries: [
        { date: "2026-06-05", amount: "62.00", currency: "EUR", partyName: "Kohvik Roheline", partyIban: null, referenceNumber: inv.referenceNumber, description: "arve", bankReference: "R1" },
        { date: "2026-06-06", amount: "-12.40", currency: "EUR", partyName: "Sidefirma AS", partyIban: "EE471000001020145685", referenceNumber: null, description: "S-777", bankReference: "R2" },
        { date: "2026-06-07", amount: "-0.50", currency: "EUR", partyName: null, partyIban: null, referenceNumber: null, description: "Teenustasu", bankReference: "R3" },
        { date: "2026-06-08", amount: "5.00", currency: "EUR", partyName: "Tundmatu", partyIban: null, referenceNumber: null, description: "?", bankReference: "R4" },
      ],
    };
    const res = await db.$transaction((tx) => importStatement(tx, companyId, userId, { bankAccountId: bankId, fileName: "v.xml", format: "CAMT053", statement }), { timeout: 20_000 });
    expect(res.imported).toBe(4);
    const lines = await db.bankStatementLine.findMany({ where: { companyId, statementId: res.id }, orderBy: { sortOrder: "asc" } });
    expect(lines.map((l) => l.status)).toEqual(["SUGGESTED", "SUGGESTED", "SUGGESTED", "NEW"]);
    expect((lines[0]!.suggestion as { reason: string }).reason).toBe("reference");
    expect((lines[2]!.suggestion as { kind: string }).kind).toBe("account");

    for (const l of lines.slice(0, 3)) {
      await db.$transaction((tx) => confirmStatementLine(tx, companyId, userId, l.id, { kind: "suggestion" }), { timeout: 20_000 });
    }
    expect((await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidTotal.toFixed(2)).toBe("62.00");
    expect((await db.purchaseInvoice.findUniqueOrThrow({ where: { id: purchaseId } })).paidTotal.toFixed(2)).toBe("12.40");

    // Sama faili uuesti importides tehinguid ei dubleerita
    const again = await db.$transaction((tx) => importStatement(tx, companyId, userId, { bankAccountId: bankId, fileName: "v.xml", format: "CAMT053", statement }), { timeout: 20_000 });
    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(4);

    // Vale konto väljavõte
    await expect(
      db.$transaction((tx) => importStatement(tx, companyId, userId, { bankAccountId: bankId, fileName: "x.xml", format: "CAMT053", statement: { ...statement, iban: "EE471000001020145685" } })),
    ).rejects.toMatchObject({ code: "ibanMismatch" });
  });
});

describe("maksekorraldus", () => {
  it("pain.001 tasumata ostuarvetest ja tasutuks märkimine", async () => {
    const purchaseId = await db.$transaction(async (tx) => {
      const id = await savePurchaseDraft(tx, companyId, userId, {
        supplierId,
        invoiceNumber: "S-900",
        date: d("2026-07-01"),
        referenceNumber: "12345",
        pricesIncludeVat: false,
        lines: [{ description: "Teenus", quantity: "1", unitPrice: "100", vatRateId: vat.KM, accountId: acc["4150"] }],
      });
      await confirmPurchase(tx, companyId, userId, id);
      return id;
    });
    const orderId = await db.$transaction((tx) =>
      createPaymentOrder(tx, companyId, userId, { bankAccountId: bankId, executionDate: d("2026-07-10"), items: [{ type: "PURCHASE_INVOICE", id: purchaseId, amount: "124.00" }] }),
    );
    const { xml } = await db.$transaction((tx) => paymentOrderXml(tx, companyId, orderId));
    expect(xml).toContain("<IBAN>EE471000001020145685</IBAN>");
    expect(xml).toContain("<Ref>12345</Ref>");
    expect(xml).toContain("<CtrlSum>124.00</CtrlSum>");
    const ids = await db.$transaction((tx) => markPaymentOrderPaid(tx, companyId, userId, orderId), { timeout: 20_000 });
    expect(ids).toHaveLength(1);
    expect((await db.purchaseInvoice.findUniqueOrThrow({ where: { id: purchaseId } })).paidTotal.toFixed(2)).toBe("124.00");
    expect((await db.paymentOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID");
  });
});
