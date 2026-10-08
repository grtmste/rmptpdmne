import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { BUSINESS_CHART, VAT_TEMPLATES } from "@/lib/accounting/templates";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { ensureCompanyDefaults } from "@/server/services/company-setup";
import { accountTotals, LedgerError, postJournalEntry } from "@/server/services/journal";
import { nextDocumentNumber } from "@/server/services/numbering";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;

let userId: string;
let companyA: string;
let companyB: string;
const acc: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "ledger@test.ee",
    name: "Pearaamat",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyA = (
    await createCompanyForUser(db, user.id, organization.id, {
      name: "Pearaamat OÜ",
      regCode: null,
      vatNumber: null,
      accountingStartDate: d("2026-01-01"),
    })
  ).id;
  companyB = (await createCompanyForUser(db, user.id, organization.id, { name: "Teine OÜ", regCode: null, vatNumber: null })).id;
  for (const a of await db.glAccount.findMany({ where: { companyId: companyA } })) acc[a.code] = a.id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("ettevõtte vaikeseadistus", () => {
  it("loob kontoplaani, käibemaksud, majandusaasta, seeriad ja dimensioonid", async () => {
    expect(await db.glAccount.count({ where: { companyId: companyA } })).toBe(BUSINESS_CHART.length);
    expect(await db.vatRate.count({ where: { companyId: companyA } })).toBe(VAT_TEMPLATES.length);
    const years = await db.fiscalYear.findMany({ where: { companyId: companyA } });
    expect(years).toHaveLength(1);
    expect(years[0]!.startDate).toEqual(d("2026-01-01"));
    expect(await db.numberSeries.count({ where: { companyId: companyA } })).toBeGreaterThan(5);
    expect(await db.dimension.count({ where: { companyId: companyA } })).toBe(2);
    const sales = await db.glAccount.findFirstOrThrow({ where: { companyId: companyA, code: "3010" }, include: { defaultVatRate: true } });
    expect(sales.defaultVatRate?.code).toBe("KM");
    const km = await db.vatRate.findFirstOrThrow({ where: { companyId: companyA, code: "KM" }, include: { periods: true, salesAccount: true } });
    expect(km.periods).toHaveLength(3);
    expect(km.salesAccount?.code).toBe("2300");
  });

  it("korduv käivitamine ei loo duplikaate", async () => {
    const result = await db.$transaction((tx) => ensureCompanyDefaults(tx, companyA, { userId }));
    expect(result).toEqual({ accounts: 0, vatRates: 0, fiscalYears: 0, numberSeries: 0, dimensions: 0 });
  });
});

describe("kanded", () => {
  it("salvestab tasakaalus kande ja võtab numbri seeriast", async () => {
    const entry = await db.$transaction((tx) =>
      postJournalEntry(tx, companyA, userId, {
        date: d("2026-03-15"),
        source: "MANUAL",
        description: "Osakapitali sissemakse",
        lines: [
          { accountId: acc["1020"]!, debit: "2500.00" },
          { accountId: acc["2900"]!, credit: "2500.00" },
        ],
      }),
    );
    expect(entry.number).toBe("PR-1");
    const totals = await accountTotals(db, companyA);
    expect(totals.get(acc["1020"]!)?.debit.toFixed(2)).toBe("2500.00");
  });

  it("tasakaalust väljas kanne ei salvestu", async () => {
    await expect(
      db.$transaction((tx) =>
        postJournalEntry(tx, companyA, userId, {
          date: d("2026-03-15"),
          source: "MANUAL",
          lines: [
            { accountId: acc["1020"]!, debit: "100" },
            { accountId: acc["2900"]!, credit: "90" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "unbalanced" });
    // Number ei läinud kaduma (transaktsioon pöörati tagasi)
    const next = await db.$transaction((tx) => nextDocumentNumber(tx, companyA, "JOURNAL_ENTRY", d("2026-03-15")));
    expect(next).toBe("PR-2");
  });

  it("aruandeaasta kasumi kontole kandeid ei tehta", async () => {
    await expect(
      db.$transaction((tx) =>
        postJournalEntry(tx, companyA, userId, {
          date: d("2026-03-15"),
          source: "MANUAL",
          lines: [
            { accountId: acc["2960"]!, debit: "1" },
            { accountId: acc["1020"]!, credit: "1" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "currentYearProfitAccount" });
  });

  it("teise ettevõtte konto ei sobi", async () => {
    const foreign = await db.glAccount.findFirstOrThrow({ where: { companyId: companyB, code: "1020" } });
    await expect(
      db.$transaction((tx) =>
        postJournalEntry(tx, companyA, userId, {
          date: d("2026-03-15"),
          source: "MANUAL",
          lines: [
            { accountId: foreign.id, debit: "1" },
            { accountId: acc["2900"]!, credit: "1" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "accountNotFound" });
  });

  it("andmebaas keelab kanderea, mis viitab teise ettevõtte kontole", async () => {
    const entry = await db.journalEntry.findFirstOrThrow({ where: { companyId: companyA } });
    const foreign = await db.glAccount.findFirstOrThrow({ where: { companyId: companyB, code: "1020" } });
    await expect(
      db.journalLine.create({ data: { companyId: companyA, entryId: entry.id, accountId: foreign.id, debit: "1" } }),
    ).rejects.toThrow();
  });

  it("väljaspool majandusaastat, lukustatud ja suletud perioodis ei saa kandeid teha", async () => {
    const lines = [
      { accountId: acc["1020"]!, debit: "1" },
      { accountId: acc["2900"]!, credit: "1" },
    ];
    await expect(
      db.$transaction((tx) => postJournalEntry(tx, companyA, userId, { date: d("2027-01-05"), source: "MANUAL", lines })),
    ).rejects.toMatchObject({ code: "noFiscalYear" });

    await db.company.update({ where: { id: companyA }, data: { lockedUntil: d("2026-03-31") } });
    await expect(
      db.$transaction((tx) => postJournalEntry(tx, companyA, userId, { date: d("2026-03-31"), source: "MANUAL", lines })),
    ).rejects.toMatchObject({ code: "locked" });
    await db.company.update({ where: { id: companyA }, data: { lockedUntil: null } });

    await db.fiscalYear.updateMany({ where: { companyId: companyA }, data: { closedAt: new Date() } });
    await expect(
      db.$transaction((tx) => postJournalEntry(tx, companyA, userId, { date: d("2026-05-01"), source: "MANUAL", lines })),
    ).rejects.toMatchObject({ code: "closedYear" });
    await db.fiscalYear.updateMany({ where: { companyId: companyA }, data: { closedAt: null } });
  });

  it("algsaldo võib olla enne esimest majandusaastat", async () => {
    const entry = await db.$transaction((tx) =>
      postJournalEntry(tx, companyA, userId, {
        date: d("2025-12-31"),
        source: "OPENING_BALANCE",
        lines: [
          { accountId: acc["1000"]!, debit: "50" },
          { accountId: acc["2950"]!, credit: "50" },
        ],
      }),
    );
    expect(entry.number).toBe("ALGSALDO");
  });

  it("kohustuslik dimensioon ja üks väärtus dimensiooni kohta", async () => {
    const project = await db.dimension.findFirstOrThrow({ where: { companyId: companyA, name: "Projekt" } });
    const [p1, p2] = await Promise.all([
      db.dimensionValue.create({ data: { companyId: companyA, dimensionId: project.id, code: "P1", name: "Projekt 1" } }),
      db.dimensionValue.create({ data: { companyId: companyA, dimensionId: project.id, code: "P2", name: "Projekt 2" } }),
    ]);
    await db.glAccount.update({ where: { id: acc["4190"]! }, data: { requiredDimensionIds: [project.id] } });
    const base = { date: d("2026-04-01"), source: "MANUAL" as const };
    await expect(
      db.$transaction((tx) =>
        postJournalEntry(tx, companyA, userId, {
          ...base,
          lines: [
            { accountId: acc["4190"]!, debit: "10" },
            { accountId: acc["1020"]!, credit: "10" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "dimensionRequired" });
    await expect(
      db.$transaction((tx) =>
        postJournalEntry(tx, companyA, userId, {
          ...base,
          lines: [
            { accountId: acc["4190"]!, debit: "10", dimensionValueIds: [p1.id, p2.id] },
            { accountId: acc["1020"]!, credit: "10" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "duplicateDimension" });
    const ok = await db.$transaction((tx) =>
      postJournalEntry(tx, companyA, userId, {
        ...base,
        lines: [
          { accountId: acc["4190"]!, debit: "10", dimensionValueIds: [p1.id] },
          { accountId: acc["1020"]!, credit: "10" },
        ],
      }),
    );
    expect(await db.journalLineDimension.count({ where: { line: { entryId: ok.id } } })).toBe(1);
  });

  it("LedgerError kannab koodi", () => {
    expect(new LedgerError("unbalanced").code).toBe("unbalanced");
  });
});

describe("numeratsioon", () => {
  it("samaaegsed päringud saavad erinevad numbrid", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => db.$transaction((tx) => nextDocumentNumber(tx, companyB, "SALES_INVOICE", d("2026-05-01")))),
    );
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.sort()).toEqual(["1001", "1002", "1003", "1004", "1005", "1006", "1007", "1008"]);
  });

  it("aastapõhine seeria algab igal aastal uuesti", async () => {
    await db.numberSeries.update({
      where: { companyId_documentType: { companyId: companyB, documentType: "QUOTE" } },
      data: { yearBased: true },
    });
    const take = (date: string) => db.$transaction((tx) => nextDocumentNumber(tx, companyB, "QUOTE", d(date)));
    expect(await take("2026-01-10")).toBe("P-2026/1");
    expect(await take("2026-02-10")).toBe("P-2026/2");
    expect(await take("2027-01-02")).toBe("P-2027/1");
  });
});
