import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { dec } from "@/lib/money";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { confirmInvoice, createCreditDraft, saveInvoiceDraft } from "@/server/services/sales";
import { confirmPurchase, createPurchaseCredit, savePurchaseDraft } from "@/server/services/purchases";
import { bookQuantities, confirmMovement, defaultWarehouseId, InventoryError, recalculateItems, saveMovementDraft } from "@/server/services/inventory";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let userId: string;
let customerId: string;
let supplierId: string;
let itemId: string;
let mainWh: string;
let secondWh: string;
const vat: Record<string, string> = {};
const acc: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "ladu@test.ee",
    name: "Ladu",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyId = (await createCompanyForUser(db, user.id, organization.id, { name: "Kaubandus OÜ", regCode: "88888888", vatNumber: null, accountingStartDate: d("2026-01-01") })).id;
  for (const v of await db.vatRate.findMany({ where: { companyId } })) vat[v.code] = v.id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  customerId = (await db.customer.create({ data: { companyId, name: "Ostja OÜ" } })).id;
  supplierId = (await db.supplier.create({ data: { companyId, name: "Hulgimüük AS" } })).id;
  itemId = (await db.item.create({ data: { companyId, code: "KOHV", name: "Kohvioad 1 kg", type: "GOODS", unit: "kg", trackStock: true, salePrice: "12", vatRateId: vat.KM } })).id;
  mainWh = await db.$transaction((tx) => defaultWarehouseId(tx, companyId, userId));
  secondWh = (await db.warehouse.create({ data: { companyId, code: "L2", name: "Kauplus" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const purchase = (date: string, quantity: string, unitPrice: string, number: string) =>
  db.$transaction(async (tx) => {
    const id = await savePurchaseDraft(tx, companyId, userId, {
      supplierId,
      invoiceNumber: number,
      date: d(date),
      pricesIncludeVat: false,
      lines: [{ itemId, description: "Kohvioad", quantity, unitPrice, vatRateId: vat.KM, accountId: acc["4010"] }],
    });
    await confirmPurchase(tx, companyId, userId, id);
    return id;
  });

const sale = (date: string, quantity: string) =>
  db.$transaction(async (tx) => {
    const id = await saveInvoiceDraft(tx, companyId, userId, {
      type: "INVOICE",
      customerId,
      date: d(date),
      pricesIncludeVat: false,
      lines: [{ itemId, description: "Kohvioad", quantity, unitPrice: "12", vatRateId: vat.KM }],
    });
    await confirmInvoice(tx, companyId, userId, id);
    return id;
  });

const movementOf = (where: { salesInvoiceId?: string; purchaseInvoiceId?: string; id?: string }) =>
  db.stockMovement.findFirstOrThrow({ where: { companyId, ...where }, include: { lines: true } });

async function entryOf(movementId: string) {
  const m = await db.stockMovement.findUniqueOrThrow({ where: { id: movementId } });
  if (!m.journalEntryId) return null;
  const e = await db.journalEntry.findUniqueOrThrow({ where: { id: m.journalEntryId }, include: { lines: { include: { account: true } } } });
  return Object.fromEntries(e.lines.map((l) => [l.account.code, dec(l.debit).minus(dec(l.credit)).toFixed(2)]));
}

async function glBalance(code: string) {
  const r = await db.journalLine.aggregate({ where: { companyId, accountId: acc[code], entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return dec(r._sum.debit ?? 0).minus(dec(r._sum.credit ?? 0)).toFixed(2);
}

async function stockValue() {
  const r = await db.stockMovementLine.aggregate({ where: { companyId, movement: { status: "CONFIRMED" } }, _sum: { totalCost: true } });
  return dec(r._sum.totalCost ?? 0).toFixed(2);
}

let saleId: string;

describe("ost ja müük (FIFO)", () => {
  it("ostuarve laokauba rida läheb laokontole ja lattu ostuhinnaga", async () => {
    const id = await purchase("2026-02-01", "10", "5", "A-1");
    const line = await db.purchaseInvoiceLine.findFirstOrThrow({ where: { invoiceId: id } });
    expect(line.accountId).toBe(acc["1340"]);
    const m = await movementOf({ purchaseInvoiceId: id });
    expect([m.type, m.warehouseId, m.lines[0]!.quantity.toFixed(0), m.lines[0]!.totalCost.toFixed(2), m.lines[0]!.fixedCost]).toEqual(["PURCHASE", mainWh, "10", "50.00", true]);
    // Ostuarve kanne kirjendas juba laokontole – omahinna kannet pole vaja
    expect(m.journalEntryId).toBeNull();
    await purchase("2026-02-10", "10", "7", "A-2");
  });

  it("müük kirjendab müüdud kauba kulu FIFO järgi", async () => {
    saleId = await sale("2026-02-15", "15");
    const m = await movementOf({ salesInvoiceId: saleId });
    expect(m.lines[0]!.quantity.toFixed(0)).toBe("-15");
    expect(m.lines[0]!.totalCost.toFixed(2)).toBe("-85.00");
    expect(await entryOf(m.id)).toEqual({ "1340": "-85.00", "4000": "85.00" });
    expect(m.number).toBe((await db.salesInvoice.findUniqueOrThrow({ where: { id: saleId } })).number);
  });

  it("laoseisust suuremat müüki ei kinnitata", async () => {
    const err = await sale("2026-02-20", "6").catch((e) => e);
    expect(err).toBeInstanceOf(InventoryError);
    expect(err.code).toBe("insufficientStock");
    expect(err.meta).toMatchObject({ date: "2026-02-20", missing: "1" });
    expect(await db.salesInvoice.count({ where: { companyId, status: "CONFIRMED" } })).toBe(1);
  });

  it("tagantjärele sisestatud ost arvutab hilisema müügi omahinna ja kande ümber", async () => {
    await purchase("2026-02-05", "5", "4", "A-0");
    const m = await movementOf({ salesInvoiceId: saleId });
    // 10 × 5 + 5 × 4
    expect(m.lines[0]!.totalCost.toFixed(2)).toBe("-70.00");
    expect(await entryOf(m.id)).toEqual({ "1340": "-70.00", "4000": "70.00" });
  });

  it("kreeditarvega tagastatud kaup tuleb lattu algse müügi omahinnaga", async () => {
    const creditId = await db.$transaction(async (tx) => {
      const id = await createCreditDraft(tx, companyId, userId, saleId, d("2026-02-16"));
      await tx.salesInvoiceLine.updateMany({ where: { invoiceId: id }, data: { quantity: "-3" } });
      await confirmInvoice(tx, companyId, userId, id);
      return id;
    });
    const m = await movementOf({ salesInvoiceId: creditId });
    // 70 / 15 × 3 = 14,00
    expect(m.lines[0]!.totalCost.toFixed(2)).toBe("14.00");
    expect(await entryOf(m.id)).toEqual({ "1340": "14.00", "4000": "-14.00" });
  });

  it("tarnijale tagastamise omahinna ja arve summa vahe läheb kulusse", async () => {
    const original = await db.purchaseInvoice.findFirstOrThrow({ where: { companyId, invoiceNumber: "A-2" } });
    const creditId = await db.$transaction(async (tx) => {
      const id = await createPurchaseCredit(tx, companyId, userId, original.id, d("2026-02-25"));
      await tx.purchaseInvoice.update({ where: { id }, data: { invoiceNumber: "A-2K" } });
      await tx.purchaseInvoiceLine.updateMany({ where: { invoiceId: id }, data: { quantity: "-2", unitPrice: "8" } });
      await confirmPurchase(tx, companyId, userId, id);
      return id;
    });
    const m = await movementOf({ purchaseInvoiceId: creditId });
    // FIFO: vanim kiht 10 × 7 → 2 tk = 14,00; tarnija krediteeris hinnaga 8 = 16,00
    expect(m.lines[0]!.totalCost.toFixed(2)).toBe("-14.00");
    expect(m.lines[0]!.bookedCost.toFixed(2)).toBe("-16.00");
    // Arve vähendas laokontot 16,00, laoseis vähenes 14,00 → vahe 2,00 tagasi laokontole, kulu väheneb
    expect(await entryOf(m.id)).toEqual({ "1340": "2.00", "4000": "-2.00" });
    expect(await glBalance("1340")).toBe(await stockValue());
  });
});

describe("käsitsi liikumised", () => {
  it("ümberpaigutus, väljaminek kulusse ja inventuur", async () => {
    const save = (input: Parameters<typeof saveMovementDraft>[3]) =>
      db.$transaction(async (tx) => {
        const id = await saveMovementDraft(tx, companyId, userId, input);
        await confirmMovement(tx, companyId, userId, id);
        return id;
      });
    const transfer = await save({ type: "TRANSFER", date: d("2026-03-01"), warehouseId: mainWh, toWarehouseId: secondWh, lines: [{ itemId, quantity: "4" }] });
    expect((await movementOf({ id: transfer })).journalEntryId).toBeNull();
    const q = await db.$transaction((tx) => bookQuantities(tx, companyId, { itemIds: [itemId] }));
    expect([q.get(`${itemId}|${mainWh}`)!.toFixed(0), q.get(`${itemId}|${secondWh}`)!.toFixed(0)]).toEqual(["7", "4"]);

    // Kaupluses on ainult 4 tk
    const err = await save({ type: "ISSUE", date: d("2026-03-02"), warehouseId: secondWh, counterAccountId: acc["4190"], lines: [{ itemId, quantity: "5" }] }).catch((e) => e);
    expect(err).toMatchObject({ code: "insufficientStock" });
    // Vastaskontota väljaminekut ei kinnitata
    const noAccount = await save({ type: "ISSUE", date: d("2026-03-02"), warehouseId: secondWh, lines: [{ itemId, quantity: "1" }] }).catch((e) => e);
    expect(noAccount).toMatchObject({ code: "counterAccountRequired" });

    const issue = await save({ type: "ISSUE", date: d("2026-03-02"), warehouseId: secondWh, counterAccountId: acc["4190"], description: "Omatarve", lines: [{ itemId, quantity: "1" }] });
    const im = await movementOf({ id: issue });
    // Ebaõnnestunud kinnitamised tühistati koos numbriga
    expect(im.number).toBe("L-2");
    // Omahind arvestatakse üle ladude: FIFO vanim kiht 8 × 7
    expect(im.lines[0]!.totalCost.toFixed(2)).toBe("-7.00");
    expect(await entryOf(issue)).toEqual({ "1340": "-7.00", "4190": "7.00" });

    // Inventuur põhilaos: arvestuslik 7, loendati 6
    const count = await save({ type: "COUNT", date: d("2026-03-03"), warehouseId: mainWh, counterAccountId: acc["4190"], lines: [{ itemId, quantity: "6" }] });
    const cm = await movementOf({ id: count });
    expect([cm.lines[0]!.countedQuantity!.toFixed(0), cm.lines[0]!.quantity.toFixed(0)]).toEqual(["6", "-1"]);
    expect(cm.lines[0]!.totalCost.toFixed(2)).toBe("-7.00");
    expect(await glBalance("1340")).toBe(await stockValue());
  });

  it("kindla hinnaga sissetulek ja vastaskonto", async () => {
    const id = await db.$transaction(async (tx) => {
      const mid = await saveMovementDraft(tx, companyId, userId, { type: "RECEIPT", date: d("2026-03-05"), warehouseId: mainWh, counterAccountId: acc["4010"], lines: [{ itemId, quantity: "2", unitCost: "6.50" }] });
      await confirmMovement(tx, companyId, userId, mid);
      return mid;
    });
    expect(await entryOf(id)).toEqual({ "1340": "13.00", "4010": "-13.00" });
  });
});

describe("omahinna meetod ja ümberarvestus", () => {
  it("kaalutud keskmise meetodile üleminekul arvutatakse avatud perioodi liikumised ümber", async () => {
    await db.company.update({ where: { id: companyId }, data: { costMethod: "AVERAGE" } });
    const changed = await db.$transaction((tx) => recalculateItems(tx, companyId, userId));
    expect(changed).toBeGreaterThan(0);
    const m = await movementOf({ salesInvoiceId: saleId });
    // 01.02 50 + 05.02 20 + 10.02 70 = 140 / 25 tk = 5,60 → 15 × 5,60
    expect(m.lines[0]!.totalCost.toFixed(2)).toBe("-84.00");
    expect(await glBalance("1340")).toBe(await stockValue());
    // Teine käivitus ei muuda midagi
    expect(await db.$transaction((tx) => recalculateItems(tx, companyId, userId))).toBe(0);
  });

  it("suletud perioodi liikumisi ümberarvestus ei muuda", async () => {
    await db.company.update({ where: { id: companyId }, data: { costMethod: "FIFO", lockedUntil: d("2026-02-28") } });
    await db.$transaction((tx) => recalculateItems(tx, companyId, userId));
    const m = await movementOf({ salesInvoiceId: saleId });
    expect(m.lines[0]!.totalCost.toFixed(2)).toBe("-84.00");
    expect(await glBalance("1340")).toBe(await stockValue());
    await db.company.update({ where: { id: companyId }, data: { lockedUntil: null } });
  });

  it("teise ettevõtte ladu ei saa kasutada", async () => {
    const { user, organization } = await createUserWithOrganization(db, { email: "teine@test.ee", name: "Teine", passwordHash: null, locale: "et", organizationName: "Teine" });
    const other = await createCompanyForUser(db, user.id, organization.id, { name: "Teine OÜ", regCode: null, vatNumber: null, accountingStartDate: d("2026-01-01") });
    const err = await db
      .$transaction((tx) => saveMovementDraft(tx, other.id, user.id, { type: "RECEIPT", date: d("2026-03-01"), warehouseId: mainWh, lines: [{ itemId, quantity: "1" }] }))
      .catch((e) => e);
    expect(err).toMatchObject({ code: "warehouseNotFound" });
  });
});
