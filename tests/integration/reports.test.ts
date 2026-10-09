import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { confirmInvoice, saveInvoiceDraft } from "@/server/services/sales";
import { confirmPurchase, savePurchaseDraft } from "@/server/services/purchases";
import { closeVatPeriod, reopenVatPeriod, VatError } from "@/server/services/vat";
import { vatReturn } from "@/server/reports/vat";
import { balanceSheet, cashFlow, incomeStatement } from "@/server/reports/financial";
import { debtsAsOf, partyTurnover } from "@/server/reports/debts";
import { purchaseReport, salesReport } from "@/server/reports/documents";
import { confirmPayment, savePayment } from "@/server/services/payments";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let userId: string;
const acc: Record<string, string> = {};
const vat: Record<string, string> = {};
const customerRef: { current: { id: string } | null } = { current: null };

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "aruanne@test.ee",
    name: "Aruandja",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyId = (await createCompanyForUser(db, user.id, organization.id, { name: "Aruanne OÜ", regCode: "12345678", vatNumber: "EE123456789", accountingStartDate: d("2026-01-01") })).id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  for (const v of await db.vatRate.findMany({ where: { companyId } })) vat[v.code] = v.id;

  const customer = (customerRef.current = await db.customer.create({ data: { companyId, name: "Klient AS", regCode: "10000001" } }));
  const supplier = await db.supplier.create({ data: { companyId, name: "Tarnija OÜ", regCode: "20000001" } });
  const euSupplier = await db.supplier.create({ data: { companyId, name: "Ads Ltd" } });

  await db.$transaction(async (tx) => {
    for (const [price, rate] of [
      ["1000", vat.KM],
      ["200", vat.KM9],
    ] as const) {
      const id = await saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId: customer.id,
        date: d("2026-05-10"),
        pricesIncludeVat: false,
        lines: [{ description: "Teenus", quantity: "1", unitPrice: price, vatRateId: rate }],
      });
      await confirmInvoice(tx, companyId, userId, id);
    }
    const p1 = await savePurchaseDraft(tx, companyId, userId, {
      supplierId: supplier.id,
      invoiceNumber: "T-1",
      date: d("2026-05-12"),
      pricesIncludeVat: false,
      lines: [
        { description: "Materjal", quantity: "1", unitPrice: "1200", vatRateId: vat.KM, accountId: acc["4010"] },
        { description: "Kütus", quantity: "1", unitPrice: "100", vatRateId: vat.AUTO50, accountId: acc["4125"] },
      ],
    });
    await confirmPurchase(tx, companyId, userId, p1);
    const p2 = await savePurchaseDraft(tx, companyId, userId, {
      supplierId: euSupplier.id,
      invoiceNumber: "EU-1",
      date: d("2026-05-20"),
      pricesIncludeVat: false,
      lines: [{ description: "Reklaam", quantity: "1", unitPrice: "200", vatRateId: vat.ELT, accountId: acc["4150"] }],
    });
    await confirmPurchase(tx, companyId, userId, p2);
  }, { timeout: 30_000 });
});

afterAll(async () => {
  await db.$disconnect();
});

const line = (r: Awaited<ReturnType<typeof vatReturn>>, code: string) => r.kmd.lines.get(code)!.toFixed(2);

describe("käibedeklaratsioon", () => {
  it("KMD read kannetest", async () => {
    const r = await vatReturn(db, companyId, { year: 2026, month: 5 });
    expect(line(r, "1")).toBe("1200.00"); // müük 1000 + EL teenuse soetus 200
    expect(line(r, "2")).toBe("200.00");
    expect(line(r, "4")).toBe("306.00"); // 240 + 18 + 48
    expect(line(r, "5")).toBe("348.00"); // 288 + 12 + 48
    expect(line(r, "5.4")).toBe("12.00");
    expect(line(r, "6")).toBe("200.00");
    expect(line(r, "12")).toBe("0.00");
    expect(line(r, "13")).toBe("42.00");
    // Teine kuu on tühi
    const june = await vatReturn(db, companyId, { year: 2026, month: 6 });
    expect(line(june, "4")).toBe("0.00");
    expect(june.kmd.hasSales).toBe(false);
  });

  it("KMD INF: partneri piirmäär ja osalise mahaarvamise kood", async () => {
    const r = await vatReturn(db, companyId, { year: 2026, month: 5 });
    expect(r.partA.map((l) => [l.partnerRegCode, l.taxRate, l.sumForRate.toFixed(2)]).sort()).toEqual([
      ["10000001", "24", "1000.00"],
      ["10000001", "9", "200.00"],
    ]);
    expect(r.partB.map((l) => [l.partnerRegCode, l.invoiceNumber, l.invoiceSum.toFixed(2), l.sumInPeriod.toFixed(2), l.comment])).toEqual([
      ["20000001", "T-1", "1612.00", "300.00", "11"],
    ]);
  });

  it("sulgemiskanne kannab saldod arveldusse; korduvat sulgemist ei lubata", async () => {
    const entryId = await db.$transaction((tx) => closeVatPeriod(tx, companyId, userId, 2026, 5));
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: { include: { account: true } } } });
    const byCode = Object.fromEntries(entry.lines.map((l) => [l.account.code, [l.debit.toFixed(2), l.credit.toFixed(2)]]));
    expect(byCode).toEqual({ "2300": ["306.00", "0.00"], "2310": ["0.00", "348.00"], "2320": ["42.00", "0.00"] });
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-05-31");

    // KMD ise ei muutu
    const r = await vatReturn(db, companyId, { year: 2026, month: 5 });
    expect(line(r, "5")).toBe("348.00");
    expect(r.closing?.id).toBe(entryId);

    await expect(db.$transaction((tx) => closeVatPeriod(tx, companyId, userId, 2026, 5))).rejects.toBeInstanceOf(VatError);
    await db.$transaction((tx) => reopenVatPeriod(tx, companyId, 2026, 5));
    expect(await db.journalEntry.count({ where: { id: entryId } })).toBe(0);
    await db.$transaction((tx) => closeVatPeriod(tx, companyId, userId, 2026, 5));
  });
});

describe("finantsaruanded", () => {
  it("bilanss on tasakaalus ja kasumiaruanne näitab sama tulemit", async () => {
    const bs = await balanceSheet(db, companyId, { date: d("2026-05-31"), compare: true });
    expect(bs.difference.toFixed(2)).toBe("0.00");
    const profit = bs.rows.find((r) => r.code === "BS_CURRENT_PROFIT")!;
    // 1000 + 200 − 1200 − (100 + 12 mittemahaarvatavat KM-i) − 200
    expect(profit.amount.toFixed(2)).toBe("-312.00");
    expect(bs.compareDate?.toISOString().slice(0, 10)).toBe("2025-12-31");

    for (const scheme of [1, 2] as const) {
      const is = await incomeStatement(db, companyId, { from: d("2026-01-01"), to: d("2026-05-31"), scheme, compare: true });
      expect(is.rows.find((r) => r.code === "IS_NET_PROFIT")!.amount.toFixed(2)).toBe("-312.00");
    }
    const is2 = await incomeStatement(db, companyId, { from: d("2026-01-01"), to: d("2026-05-31"), scheme: 2, compare: false });
    expect(is2.rows.find((r) => r.code === "S2_REVENUE")!.amount.toFixed(2)).toBe("1200.00");
    expect(is2.rows.find((r) => r.code === "S2_COST_OF_SALES")!.amount.toFixed(2)).toBe("-1200.00");
  });

  it("rahavood: rahaliikumist pole, vahe puudub", async () => {
    const cf = await cashFlow(db, companyId, { from: d("2026-01-01"), to: d("2026-05-31") });
    expect(cf.difference.toFixed(2)).toBe("0.00");
    expect(cf.rows.find((r) => r.code === "CF_NET")!.amount.toFixed(2)).toBe("0.00");
    expect(cf.rows.find((r) => r.code === "CF_OPERATING_PROFIT")!.amount.toFixed(2)).toBe("-312.00");
  });
});

describe("võlgnevused ja müügiaruanne", () => {
  it("laekumine ja ettemaks vähendavad kliendi võlga; käibeandmik on kooskõlas", async () => {
    const bank = await db.bankAccount.findFirstOrThrow({ where: { companyId, kind: "BANK" } });
    const invoice = await db.salesInvoice.findFirstOrThrow({ where: { companyId, total: 1240 } });
    await db.$transaction(async (tx) => {
      const p1 = await savePayment(tx, companyId, userId, {
        direction: "IN",
        bankAccountId: bank.id,
        date: d("2026-06-01"),
        amount: "600",
        partyType: "CUSTOMER",
        customerId: customerRef.current!.id,
        allocations: [
          { type: "SALES_INVOICE", salesInvoiceId: invoice.id, amount: "500" },
          { type: "PREPAYMENT", amount: "100" },
        ],
      });
      await confirmPayment(tx, companyId, userId, p1);
    });

    const may = await debtsAsOf(db, companyId, "receivables", d("2026-05-31"));
    expect(may.totals.total.toFixed(2)).toBe("1458.00");
    // Tähtaeg 14 päeva (24.05) → 31.05 seisuga 7 päeva üle tähtaja
    expect(may.totals.buckets.d1_30.toFixed(2)).toBe("1458.00");

    const june = await debtsAsOf(db, companyId, "receivables", d("2026-06-30"));
    expect(june.rows).toHaveLength(1);
    expect(june.rows[0]!.prepayment.toFixed(2)).toBe("100.00");
    expect(june.totals.total.toFixed(2)).toBe("858.00");
    expect(june.totals.buckets.d31_60.toFixed(2)).toBe("958.00");

    const turnover = await partyTurnover(db, companyId, "receivables", d("2026-06-01"), d("2026-06-30"));
    expect(turnover.rows.map((r) => [r.partyName, r.opening.toFixed(2), r.invoiced.toFixed(2), r.paid.toFixed(2), r.closing.toFixed(2)])).toEqual([
      ["Klient AS", "1458.00", "0.00", "600.00", "858.00"],
    ]);

    const payables = await debtsAsOf(db, companyId, "payables", d("2026-06-30"));
    expect(payables.totals.total.toFixed(2)).toBe("1812.00");
  });

  it("müügi- ja ostuaruanne rühmituste kaupa", async () => {
    const byCustomer = await salesReport(db, companyId, { from: d("2026-05-01"), to: d("2026-05-31"), group: "customer" });
    expect(byCustomer.rows.map((r) => [r.label, r.count, r.net.toFixed(2), r.total.toFixed(2)])).toEqual([["Klient AS", 2, "1200.00", "1458.00"]]);
    const byMonth = await salesReport(db, companyId, { from: d("2026-01-01"), to: d("2026-12-31"), group: "month" });
    expect(byMonth.rows.map((r) => r.label)).toEqual(["2026-05"]);
    const byAccount = await purchaseReport(db, companyId, { from: d("2026-05-01"), to: d("2026-05-31"), group: "account" });
    expect(byAccount.totals.net.toFixed(2)).toBe("1500.00");
    expect(byAccount.rows.map((r) => r.label.slice(0, 4)).sort()).toEqual(["4010", "4125", "4150"]);
  });
});
