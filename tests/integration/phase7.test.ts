import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { confirmInvoice, saveInvoiceDraft, saveQuote, SalesError } from "@/server/services/sales";
import { dueRecurring, runRecurring, saveRecurring } from "@/server/services/recurring";
import { createInterestInvoices, interestCandidates } from "@/server/services/interest";
import { consolidateQuotes } from "@/server/services/consolidated";
import { confirmPayment, savePayment } from "@/server/services/payments";
import { statementCandidates } from "@/server/sales/statements";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let userId: string;
let customerId: string;
const vat: Record<string, string> = {};
const acc: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "faas7@test.ee",
    name: "Seitse",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyId = (await createCompanyForUser(db, user.id, organization.id, { name: "Seitse OÜ", regCode: "77777777", vatNumber: null, accountingStartDate: d("2026-01-01") })).id;
  for (const v of await db.vatRate.findMany({ where: { companyId } })) vat[v.code] = v.id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  customerId = (await db.customer.create({ data: { companyId, name: "Üürnik OÜ", email: "uurnik@example.ee", lateInterestPct: "0.1" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("perioodilised arved", () => {
  it("koostab arved ajakava järgi, kohatäited täidetud, kinnitab ja liigub edasi", async () => {
    const id = await db.$transaction((tx) =>
      saveRecurring(tx, companyId, userId, {
        name: "Büroo üür",
        customerId,
        active: true,
        mode: "CONFIRM",
        intervalMonths: 1,
        startDate: d("2026-01-31"),
        endDate: d("2026-03-31"),
        pricesIncludeVat: false,
        notes: "Üür [periood]",
        lines: [{ description: "Ruumide üür [kuu] [aasta]", quantity: "1", unitPrice: "500", vatRateId: vat.KM }],
      }),
    );
    let r = await db.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect(toISODate(r.nextDate!)).toBe("2026-01-31");

    const due = await dueRecurring(db, d("2026-02-28"));
    expect(due.map((x) => x.id)).toEqual([id]);

    const first = await db.$transaction((tx) => runRecurring(tx, companyId, userId, id));
    const second = await db.$transaction((tx) => runRecurring(tx, companyId, userId, id));
    expect(first.send).toBe(false);
    const invoices = await db.salesInvoice.findMany({
      where: { id: { in: [first.invoiceId, second.invoiceId] } },
      include: { lines: true },
      orderBy: { date: "asc" },
    });
    expect(invoices.map((i) => [toISODate(i.date), i.status, i.lines[0]!.description, i.notes])).toEqual([
      ["2026-01-31", "CONFIRMED", "Ruumide üür jaanuar 2026", "Üür jaanuar 2026"],
      ["2026-02-28", "CONFIRMED", "Ruumide üür veebruar 2026", "Üür veebruar 2026"],
    ]);
    expect(invoices[0]!.recurringInvoiceId).toBe(id);
    r = await db.recurringInvoice.findUniqueOrThrow({ where: { id } });
    expect([r.runCount, toISODate(r.nextDate!)]).toEqual([2, "2026-03-31"]);

    await db.$transaction((tx) => runRecurring(tx, companyId, userId, id));
    r = await db.recurringInvoice.findUniqueOrThrow({ where: { id } });
    // Lõppkuupäev käes – ajakava lõppenud
    expect(r.nextDate).toBeNull();
    await expect(db.$transaction((tx) => runRecurring(tx, companyId, userId, id))).rejects.toBeInstanceOf(SalesError);
    expect(await dueRecurring(db, d("2026-12-31"))).toHaveLength(0);
  });
});

describe("viivised", () => {
  it("osamaksega arve viivis, viivisearve ja jätkamine järgmisest päevast", async () => {
    // Arve 1000 + KM, tähtaeg 14 päeva (15.04), viivis 0,1% päevas
    const invoiceId = await db.$transaction(async (tx) => {
      const id = await saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId,
        date: d("2026-04-01"),
        pricesIncludeVat: false,
        lines: [{ description: "Teenus", quantity: "1", unitPrice: "1000", vatRateId: vat.KM }],
      });
      await confirmInvoice(tx, companyId, userId, id);
      return id;
    });
    const bank = await db.bankAccount.findFirstOrThrow({ where: { companyId, kind: "BANK" } });
    await db.$transaction(async (tx) => {
      const p = await savePayment(tx, companyId, userId, {
        direction: "IN",
        bankAccountId: bank.id,
        date: d("2026-04-25"),
        amount: "740",
        partyType: "CUSTOMER",
        customerId,
        allocations: [{ type: "SALES_INVOICE", salesInvoiceId: invoiceId, amount: "740" }],
      });
      await confirmPayment(tx, companyId, userId, p);
    });

    // 16.04–25.04: 10 p × 1240 × 0,1% = 12,40; 26.04–30.04: 5 p × 500 × 0,1% = 2,50
    const april = await interestCandidates(db, companyId, d("2026-04-30"));
    const row = april.flatMap((c) => c.rows).find((r) => r.invoiceId === invoiceId)!;
    expect([toISODate(row.from), row.days, row.amount.toFixed(2), row.open.toFixed(2)]).toEqual(["2026-04-16", 15, "14.90", "500.00"]);

    const [interestId] = await db.$transaction((tx) =>
      createInterestInvoices(tx, companyId, userId, { asOf: d("2026-04-30"), date: d("2026-04-30"), customerIds: [customerId], confirm: true }),
    );
    const interest = await db.salesInvoice.findUniqueOrThrow({ where: { id: interestId }, include: { lines: true } });
    expect(interest.isInterest).toBe(true);
    expect(interest.number).toBe("V-1");
    expect(interest.lateInterestPct).toBeNull();
    const charged = interest.lines.find((l) => l.description.includes("16.04.2026–30.04.2026"))!;
    expect(charged.netAmount.toFixed(2)).toBe("14.90");
    expect(charged.vatAmount.toFixed(2)).toBe("0.00");
    expect(charged.accountId).toBe(acc["3800"]);

    // Uus arvestus jätkub 01.05-st: 10 p × 500 × 0,1% = 5,00; viivisearvele endale viivist ei arvestata
    const may = await interestCandidates(db, companyId, d("2026-05-10"));
    const rows = may.flatMap((c) => c.rows);
    expect(rows.find((r) => r.invoiceId === interestId)).toBeUndefined();
    const again = rows.find((r) => r.invoiceId === invoiceId)!;
    expect([toISODate(again.from), again.days, again.amount.toFixed(2)]).toEqual(["2026-05-01", 10, "5.00"]);
  });
});

describe("koondarve ja meeldetuletused", () => {
  it("kaks pakkumist üheks arveks", async () => {
    const q = await db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const price of ["100", "50"]) {
        ids.push(
          await saveQuote(tx, companyId, userId, {
            customerId,
            date: d("2026-05-02"),
            validUntil: d("2026-05-30"),
            pricesIncludeVat: false,
            lines: [{ description: `Töö ${price}`, quantity: "1", unitPrice: price, vatRateId: vat.KM }],
          }),
        );
      }
      return ids;
    });
    const invoiceId = await db.$transaction((tx) => consolidateQuotes(tx, companyId, userId, q, d("2026-05-05")));
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    expect(inv.netTotal.toFixed(2)).toBe("150.00");
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]!.description).toMatch(/^P-\d+: Töö 100$/);
    const quotes = await db.quote.findMany({ where: { id: { in: q } } });
    expect(quotes.every((x) => x.status === "INVOICED" && x.invoiceId === invoiceId)).toBe(true);
    await expect(db.$transaction((tx) => consolidateQuotes(tx, companyId, userId, q, d("2026-05-05")))).rejects.toBeInstanceOf(SalesError);
  });

  it("meeldetuletuses ainult tähtaja ületanud arved, saldoteatises kogu saldo", async () => {
    const reminders = await statementCandidates(companyId, "REMINDER", d("2026-05-10"));
    const r = reminders.find((x) => x.customerId === customerId)!;
    // Avatud: 3 perioodilist arvet à 620 ja aprilli arve jääk 500 (üle tähtaja);
    // viivisearve 14,90 (tähtaeg 14.05) veel mitte
    expect(r.documents.map((x) => x.openBase.toFixed(2))).toEqual(["620.00", "620.00", "620.00", "500.00"]);
    expect(r.total.toFixed(2)).toBe("2360.00");
    expect(r.email).toBe("uurnik@example.ee");

    const statements = await statementCandidates(companyId, "STATEMENT", d("2026-05-10"));
    const s = statements.find((x) => x.customerId === customerId)!;
    // + viivisearve 100,46 (14,90 aprilli arvelt ja 85,56 perioodilistelt arvetelt)
    expect(s.total.toFixed(2)).toBe("2460.46");
    // Kõrge päevade piir jätab kliendi välja
    expect((await statementCandidates(companyId, "REMINDER", d("2026-05-10"), 120)).find((x) => x.customerId === customerId)).toBeUndefined();
  });
});
