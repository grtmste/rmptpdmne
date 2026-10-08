import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { isValidReferenceNumber } from "@/lib/accounting/numbering";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import {
  confirmInvoice,
  copyInvoice,
  createCreditDraft,
  createTaxFreeDraft,
  deleteInvoiceDraft,
  openPrepayments,
  quoteToInvoice,
  saveInvoiceDraft,
  saveQuote,
  SalesError,
} from "@/server/services/sales";
import { trialBalance } from "@/server/reports/ledger";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let otherCompanyId: string;
let userId: string;
let customerId: string;
const acc: Record<string, string> = {};
const vat: Record<string, string> = {};

async function balances(from = "2026-01-01", to = "2026-12-31") {
  const tb = await trialBalance(db, companyId, { from: d(from), to: d(to) });
  return Object.fromEntries(
    tb.rows.map((r) => [r.code, r.closing.toFixed(2)]),
  ) as Record<string, string>;
}

async function ledgerLines(invoiceId: string) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { companyId, source: "SALES_INVOICE", sourceId: invoiceId },
    include: { lines: { include: { account: true }, orderBy: { sortOrder: "asc" } } },
  });
  return entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2), l.vatAmount?.toFixed(2) ?? null]);
}

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "muuk@test.ee",
    name: "Müüja",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  const mk = (name: string) =>
    createCompanyForUser(db, user.id, organization.id, { name, regCode: null, vatNumber: null, accountingStartDate: d("2026-01-01") });
  companyId = (await mk("Müük OÜ")).id;
  otherCompanyId = (await mk("Teine OÜ")).id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  for (const v of await db.vatRate.findMany({ where: { companyId } })) vat[v.code] = v.id;
  customerId = (
    await db.customer.create({ data: { companyId, name: "Ostja AS", regCode: "10000000", email: "ostja@test.ee" } })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("müügiarve", () => {
  let invoiceId: string;

  it("mustand arvutab summad ega tee kannet", async () => {
    invoiceId = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId,
        date: d("2026-03-10"),
        pricesIncludeVat: false,
        lines: [
          { description: "Konsultatsioon", quantity: "10", unitPrice: "50", vatRateId: vat.KM },
          { description: "Raamat", quantity: "2", unitPrice: "20", vatRateId: vat.KM9, accountId: acc["3000"] },
        ],
      }),
    );
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
    expect(inv.status).toBe("DRAFT");
    expect(inv.number).toBeNull();
    expect(inv.netTotal.toFixed(2)).toBe("540.00");
    expect(inv.vatTotal.toFixed(2)).toBe("123.60");
    expect(inv.total.toFixed(2)).toBe("663.60");
    expect(inv.dueDate.toISOString().slice(0, 10)).toBe("2026-03-24");
    expect(inv.customerName).toBe("Ostja AS");
    // Vaikimisi tulukonto
    expect(inv.lines.find((l) => l.description === "Konsultatsioon")!.accountId).toBe(acc["3010"]);
    expect(await db.journalEntry.count({ where: { companyId, source: "SALES_INVOICE" } })).toBe(0);
  });

  it("kinnitamine annab numbri, viitenumbri ja kande", async () => {
    const res = await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, invoiceId));
    expect(res.number).toBe("1001");
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe("CONFIRMED");
    expect(inv.referenceNumber).toBe("10016");
    expect(isValidReferenceNumber(inv.referenceNumber!)).toBe(true);
    expect(await ledgerLines(invoiceId)).toEqual([
      ["1200", "663.60", "0.00", null],
      ["3010", "0.00", "500.00", "120.00"],
      ["3000", "0.00", "40.00", "3.60"],
      ["2300", "0.00", "123.60", null],
    ]);
  });

  it("kinnitatud arvet ei saa muuta, kustutada ega uuesti kinnitada", async () => {
    await expect(
      db.$transaction((tx) =>
        saveInvoiceDraft(tx, companyId, userId, {
          id: invoiceId,
          type: "INVOICE",
          customerId,
          date: d("2026-03-10"),
          pricesIncludeVat: false,
          lines: [{ description: "x", quantity: "1", unitPrice: "1" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "notDraft" });
    await expect(db.$transaction((tx) => deleteInvoiceDraft(tx, companyId, invoiceId))).rejects.toMatchObject({ code: "notDraft" });
    await expect(db.$transaction((tx) => confirmInvoice(tx, companyId, userId, invoiceId))).rejects.toMatchObject({ code: "notDraft" });
  });

  it("kreeditarve kasutab algse arve määra ega tohi ületada arve summat", async () => {
    const creditId = await db.$transaction((tx) => createCreditDraft(tx, companyId, userId, invoiceId, d("2026-04-02")));
    const draft = await db.salesInvoice.findUniqueOrThrow({ where: { id: creditId }, include: { lines: true } });
    expect(draft.type).toBe("CREDIT");
    expect(draft.total.toFixed(2)).toBe("-663.60");
    // Vähendame krediteeritavat kogust ja kinnitame
    await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        id: creditId,
        type: "CREDIT",
        customerId,
        date: d("2026-04-02"),
        pricesIncludeVat: false,
        lines: [{ description: "Konsultatsioon", quantity: "-2", unitPrice: "50", vatRateId: vat.KM }],
      }),
    );
    const res = await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, creditId));
    expect(res.number).toBe("K-1");
    expect(await ledgerLines(creditId)).toEqual([
      ["1200", "0.00", "124.00", null],
      ["3010", "100.00", "0.00", "24.00"],
      ["2300", "24.00", "0.00", null],
    ]);
    // Teine kreeditarve üle järelejäänud summa
    const second = await db.$transaction((tx) => createCreditDraft(tx, companyId, userId, invoiceId, d("2026-04-03")));
    await expect(db.$transaction((tx) => confirmInvoice(tx, companyId, userId, second))).rejects.toMatchObject({
      code: "creditExceedsOriginal",
    });
    await db.$transaction((tx) => deleteInvoiceDraft(tx, companyId, second));
  });

  it("kreeditarve peab olema negatiivne", async () => {
    const creditId = await db.$transaction((tx) => createCreditDraft(tx, companyId, userId, invoiceId, d("2026-04-05")));
    await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        id: creditId,
        type: "CREDIT",
        customerId,
        date: d("2026-04-05"),
        pricesIncludeVat: false,
        lines: [{ description: "Vale märk", quantity: "1", unitPrice: "10", vatRateId: vat.KM }],
      }),
    );
    await expect(db.$transaction((tx) => confirmInvoice(tx, companyId, userId, creditId))).rejects.toMatchObject({
      code: "creditNotNegative",
    });
    await db.$transaction((tx) => deleteInvoiceDraft(tx, companyId, creditId));
  });

  it("vana määraga kuupäeval kasutatakse kehtinud määra", async () => {
    // 2025. aasta juunis kehtis 22%; majandusaasta puudub, seega kinnitada ei saa, aga mustandis on õige määr
    const id = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId,
        date: d("2025-06-15"),
        pricesIncludeVat: false,
        lines: [{ description: "Vana teenus", quantity: "1", unitPrice: "100", vatRateId: vat.KM }],
      }),
    );
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(inv.lines[0]!.vatPct.toFixed(2)).toBe("22.00");
    expect(inv.vatTotal.toFixed(2)).toBe("22.00");
    await expect(db.$transaction((tx) => confirmInvoice(tx, companyId, userId, id))).rejects.toMatchObject({ code: "noFiscalYear" });
    await db.$transaction((tx) => deleteInvoiceDraft(tx, companyId, id));
  });
});

describe("ettemaksuarve ja lõpparve", () => {
  it("ettemaks läheb ettemaksete kontole ja tasaarveldatakse lõpparvel", async () => {
    const prepId = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "PREPAYMENT",
        customerId,
        date: d("2026-05-01"),
        pricesIncludeVat: false,
        lines: [{ description: "Ettemaks tööde eest", quantity: "1", unitPrice: "300", vatRateId: vat.KM }],
      }),
    );
    const prep = await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, prepId));
    expect(prep.number).toBe("E-1");
    expect(await ledgerLines(prepId)).toEqual([
      ["1200", "372.00", "0.00", null],
      ["2500", "0.00", "300.00", "72.00"],
      ["2300", "0.00", "72.00", null],
    ]);

    const open = await openPrepayments(db, companyId, customerId);
    expect(open.map((p) => [p.number, p.remainingTotal])).toEqual([["E-1", "300.00"]]);

    const finalId = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId,
        date: d("2026-05-20"),
        pricesIncludeVat: false,
        lines: [
          { description: "Tööd kokku", quantity: "1", unitPrice: "1000", vatRateId: vat.KM },
          { description: "Ettemaks E-1", quantity: "-1", unitPrice: "300", vatRateId: vat.KM, prepaymentInvoiceId: prepId },
        ],
      }),
    );
    await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, finalId));
    expect(await ledgerLines(finalId)).toEqual([
      ["1200", "868.00", "0.00", null],
      ["3010", "0.00", "1000.00", "240.00"],
      ["2500", "300.00", "0.00", "72.00"],
      ["2300", "0.00", "168.00", null],
    ]);
    expect(await openPrepayments(db, companyId, customerId)).toEqual([]);
    const b = await balances("2026-05-01", "2026-05-31");
    expect(b["2500"]).toBe("0.00");
  });
});

describe("erijuhud", () => {
  it("kasuminormi erikord: arvel KM-i pole, maks juurdehindlusest", async () => {
    const id = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId,
        date: d("2026-06-01"),
        pricesIncludeVat: false,
        lines: [
          { description: "Kasutatud auto", quantity: "1", unitPrice: "6200", unitCost: "5000", vatRateId: vat.KAS, accountId: acc["3000"] },
        ],
      }),
    );
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id } });
    expect(inv.vatTotal.toFixed(2)).toBe("0.00");
    expect(inv.total.toFixed(2)).toBe("6200.00");
    await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, id));
    // 1200 × 24/124 = 232,26
    expect(await ledgerLines(id)).toEqual([
      ["1200", "6200.00", "0.00", null],
      ["3000", "0.00", "5967.74", "232.26"],
      ["2300", "0.00", "232.26", null],
    ]);
  });

  it("tax-free: müük reisijale muudetakse 0% ekspordiks ja KM tagastatakse", async () => {
    const id = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId,
        date: d("2026-06-10"),
        pricesIncludeVat: true,
        lines: [{ description: "Kasukas", quantity: "1", unitPrice: "1240", vatRateId: vat.KM, accountId: acc["3000"] }],
      }),
    );
    await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, id));
    const tfId = await db.$transaction((tx) => createTaxFreeDraft(tx, companyId, userId, id, d("2026-06-20")));
    const tf = await db.salesInvoice.findUniqueOrThrow({ where: { id: tfId } });
    expect(tf.taxFree).toBe(true);
    expect(tf.total.toFixed(2)).toBe("-240.00");
    await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, tfId));
    expect(await ledgerLines(tfId)).toEqual([
      ["1200", "0.00", "240.00", null],
      ["3000", "1000.00", "0.00", "240.00"],
      ["3040", "0.00", "1000.00", "0.00"],
      ["2300", "240.00", "0.00", null],
    ]);
  });

  it("valuutaarve kanne on eurodes", async () => {
    await db.exchangeRate.create({ data: { currency: "USD", date: d("2026-06-29"), rate: "1.25" } });
    const usdCustomer = await db.customer.create({ data: { companyId, name: "US Inc", countryCode: "US", currency: "USD" } });
    const id = await db.$transaction((tx) =>
      saveInvoiceDraft(tx, companyId, userId, {
        type: "INVOICE",
        customerId: usdCustomer.id,
        date: d("2026-06-30"),
        pricesIncludeVat: false,
        lines: [{ description: "Export service", quantity: "1", unitPrice: "1000", vatRateId: vat["0EKS"], accountId: acc["3040"] }],
      }),
    );
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id } });
    expect(inv.currency).toBe("USD");
    expect(inv.currencyRate.toString()).toBe("1.25");
    expect(inv.totalBase.toFixed(2)).toBe("800.00");
    await db.$transaction((tx) => confirmInvoice(tx, companyId, userId, id));
    expect(await ledgerLines(id)).toEqual([
      ["1200", "800.00", "0.00", null],
      ["3040", "0.00", "800.00", "0.00"],
    ]);
  });
});

describe("pakkumised ja koopiad", () => {
  it("pakkumisest saab arve mustandi; pakkumine märgitakse arveks tehtuks", async () => {
    const quoteId = await db.$transaction((tx) =>
      saveQuote(tx, companyId, userId, {
        customerId,
        date: d("2026-07-01"),
        validUntil: d("2026-07-15"),
        pricesIncludeVat: false,
        lines: [{ description: "Kodulehe arendus", quantity: "40", unitPrice: "60", vatRateId: vat.KM }],
      }),
    );
    const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
    expect(quote.number).toBe("P-1");
    expect(quote.total.toFixed(2)).toBe("2976.00");
    const invoiceId = await db.$transaction((tx) => quoteToInvoice(tx, companyId, userId, quoteId, d("2026-07-20")));
    const inv = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.total.toFixed(2)).toBe("2976.00");
    expect(inv.quoteId).toBe(quoteId);
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("INVOICED");
    await expect(db.$transaction((tx) => quoteToInvoice(tx, companyId, userId, quoteId, d("2026-07-20")))).rejects.toMatchObject({
      code: "quoteInvoiced",
    });
    // Mustandi kustutamine vabastab pakkumise
    await db.$transaction((tx) => deleteInvoiceDraft(tx, companyId, invoiceId));
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("ACCEPTED");
  });

  it("arve kopeerimine teeb uue mustandi", async () => {
    const source = await db.salesInvoice.findFirstOrThrow({ where: { companyId, number: "1001" } });
    const copyId = await db.$transaction((tx) => copyInvoice(tx, companyId, userId, source.id, d("2026-08-01")));
    const copy = await db.salesInvoice.findUniqueOrThrow({ where: { id: copyId } });
    expect(copy.status).toBe("DRAFT");
    expect(copy.total.toFixed(2)).toBe(source.total.toFixed(2));
  });
});

describe("ettevõtete eraldatus", () => {
  it("teise ettevõtte klienti, artiklit ega käibemaksu ei saa kasutada", async () => {
    const foreignVat = await db.vatRate.findFirstOrThrow({ where: { companyId: otherCompanyId, code: "KM" } });
    await expect(
      db.$transaction((tx) =>
        saveInvoiceDraft(tx, otherCompanyId, userId, {
          type: "INVOICE",
          customerId,
          date: d("2026-03-10"),
          pricesIncludeVat: false,
          lines: [{ description: "x", quantity: "1", unitPrice: "1" }],
        }),
      ),
    ).rejects.toBeInstanceOf(SalesError);
    await expect(
      db.$transaction((tx) =>
        saveInvoiceDraft(tx, companyId, userId, {
          type: "INVOICE",
          customerId,
          date: d("2026-03-10"),
          pricesIncludeVat: false,
          lines: [{ description: "x", quantity: "1", unitPrice: "1", vatRateId: foreignVat.id }],
        }),
      ),
    ).rejects.toMatchObject({ code: "vatRateNotFound" });
    const invoice = await db.salesInvoice.findFirstOrThrow({ where: { companyId } });
    await expect(db.$transaction((tx) => confirmInvoice(tx, otherCompanyId, userId, invoice.id))).rejects.toMatchObject({
      code: "invoiceNotFound",
    });
  });
});
