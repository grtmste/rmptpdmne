import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate } from "@/lib/accounting/dates";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { copyToDraft, deleteDraft, postDraft, postJournalEntry, reverseEntry, saveDraft } from "@/server/services/journal";
import { dayBook, generalLedger, trialBalance } from "@/server/reports/ledger";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let userId: string;
const acc: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "faas2@test.ee",
    name: "Faas 2",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyId = (
    await createCompanyForUser(db, user.id, organization.id, {
      name: "Kanded OÜ",
      regCode: null,
      vatNumber: null,
      accountingStartDate: d("2025-01-01"),
    })
  ).id;
  await db.fiscalYear.create({ data: { companyId, startDate: d("2026-01-01"), endDate: d("2026-12-31") } });
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;

  // Algsaldo ja 2025. aasta tegevus
  await db.$transaction((tx) =>
    postJournalEntry(tx, companyId, userId, {
      date: d("2024-12-31"),
      source: "OPENING_BALANCE",
      lines: [
        { accountId: acc["1020"]!, debit: "1000" },
        { accountId: acc["2900"]!, credit: "1000" },
      ],
    }),
  );
  await db.$transaction((tx) =>
    postJournalEntry(tx, companyId, userId, {
      date: d("2025-06-01"),
      source: "MANUAL",
      description: "2025 müük",
      lines: [
        { accountId: acc["1020"]!, debit: "500" },
        { accountId: acc["3010"]!, credit: "500" },
      ],
    }),
  );
  await db.$transaction((tx) =>
    postJournalEntry(tx, companyId, userId, {
      date: d("2025-07-01"),
      source: "MANUAL",
      lines: [
        { accountId: acc["4190"]!, debit: "200" },
        { accountId: acc["1020"]!, credit: "200" },
      ],
    }),
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("mustandid ja postitamine", () => {
  let draftId: string;

  it("mustand võib olla tasakaalust väljas ega mõjuta saldosid", async () => {
    draftId = await db.$transaction((tx) =>
      saveDraft(tx, companyId, userId, {
        date: d("2026-02-10"),
        description: "Üür",
        lines: [
          { accountId: acc["4100"]!, debit: "300" },
          { accountId: acc["1020"]!, credit: "250" },
          { accountId: "", debit: "" },
        ],
      }),
    );
    const draft = await db.journalEntry.findUniqueOrThrow({ where: { id: draftId }, include: { lines: true } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.number).toBeNull();
    expect(draft.lines).toHaveLength(2);
    const tb = await trialBalance(db, companyId, { from: d("2026-01-01"), to: d("2026-12-31") });
    expect(tb.rows.find((r) => r.code === "4100")).toBeUndefined();
  });

  it("tasakaalust väljas mustandit ei saa postitada", async () => {
    await expect(db.$transaction((tx) => postDraft(tx, companyId, userId, draftId))).rejects.toMatchObject({ code: "unbalanced" });
  });

  it("parandatud mustand postitatakse numbriga", async () => {
    await db.$transaction((tx) =>
      saveDraft(tx, companyId, userId, {
        id: draftId,
        date: d("2026-02-10"),
        description: "Üür",
        lines: [
          { accountId: acc["4100"]!, debit: "300" },
          { accountId: acc["1020"]!, credit: "300" },
        ],
      }),
    );
    const res = await db.$transaction((tx) => postDraft(tx, companyId, userId, draftId));
    expect(res.number).toMatch(/^PR-\d+$/);
    await expect(db.$transaction((tx) => postDraft(tx, companyId, userId, draftId))).rejects.toMatchObject({ code: "notDraft" });
    await expect(
      db.$transaction((tx) => saveDraft(tx, companyId, userId, { id: draftId, date: d("2026-02-10"), lines: [] })),
    ).rejects.toMatchObject({ code: "notDraft" });
    await expect(db.$transaction((tx) => deleteDraft(tx, companyId, draftId))).rejects.toMatchObject({ code: "notDraft" });
  });

  it("storno vahetab pooled ja seda saab teha ühe korra", async () => {
    const reversal = await db.$transaction((tx) => reverseEntry(tx, companyId, userId, draftId, { date: d("2026-02-15") }));
    const lines = await db.journalLine.findMany({ where: { entryId: reversal.id }, orderBy: { sortOrder: "asc" } });
    expect(lines.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ["0.00", "300.00"],
      ["300.00", "0.00"],
    ]);
    expect(reversal.reversalOfId).toBe(draftId);
    await expect(
      db.$transaction((tx) => reverseEntry(tx, companyId, userId, draftId, { date: d("2026-02-15") })),
    ).rejects.toMatchObject({ code: "alreadyReversed" });
    await expect(
      db.$transaction((tx) => reverseEntry(tx, companyId, userId, reversal.id, { date: d("2026-02-15") })),
    ).rejects.toMatchObject({ code: "cannotReverse" });
  });

  it("algsaldot ei saa stornida", async () => {
    const opening = await db.journalEntry.findFirstOrThrow({ where: { companyId, source: "OPENING_BALANCE" } });
    await expect(
      db.$transaction((tx) => reverseEntry(tx, companyId, userId, opening.id, { date: d("2026-02-15") })),
    ).rejects.toMatchObject({ code: "cannotReverse" });
  });

  it("kopeerimine teeb uue mustandi", async () => {
    const copyId = await db.$transaction((tx) => copyToDraft(tx, companyId, userId, draftId, d("2026-03-01")));
    const copy = await db.journalEntry.findUniqueOrThrow({ where: { id: copyId }, include: { lines: true } });
    expect(copy.status).toBe("DRAFT");
    expect(copy.lines).toHaveLength(2);
    await db.$transaction((tx) => deleteDraft(tx, companyId, copyId));
    expect(await db.journalEntry.count({ where: { id: copyId } })).toBe(0);
  });
});

describe("aruanded", () => {
  it("käibeandmik: tulu-kulu nullitakse uue aasta alguses, tulem läheb jaotamata kasumisse", async () => {
    const tb = await trialBalance(db, companyId, { from: d("2026-01-01"), to: d("2026-12-31") });
    const row = (code: string) => tb.rows.find((r) => r.code === code);
    expect(row("1020")!.opening.toFixed(2)).toBe("1300.00");
    expect(row("3010")).toBeUndefined(); // 2025 tulu ei kandu 2026 algsaldosse
    // 2025 kasum 300 → jaotamata kasum (kreedit)
    expect(row("2950")!.opening.toFixed(2)).toBe("-300.00");
    // Veebruari üür ja selle storno
    expect(row("4100")!.debit.toFixed(2)).toBe("300.00");
    expect(row("4100")!.credit.toFixed(2)).toBe("300.00");
    expect(row("4100")!.closing.toFixed(2)).toBe("0.00");
    // Käibeandmik on tasakaalus
    expect(tb.totals.openingDebit.toFixed(2)).toBe(tb.totals.openingCredit.toFixed(2));
    expect(tb.totals.debit.toFixed(2)).toBe(tb.totals.credit.toFixed(2));
    expect(tb.totals.closingDebit.toFixed(2)).toBe(tb.totals.closingCredit.toFixed(2));
  });

  it("käibeandmik aasta sees: tulud on jooksva aasta algusest", async () => {
    const tb = await trialBalance(db, companyId, { from: d("2025-07-01"), to: d("2025-12-31") });
    expect(tb.rows.find((r) => r.code === "3010")!.opening.toFixed(2)).toBe("-500.00");
    expect(tb.rows.find((r) => r.code === "4190")!.debit.toFixed(2)).toBe("200.00");
  });

  it("pearaamat: jooksev saldo ja lõppsaldo", async () => {
    const gl = await generalLedger(db, companyId, { from: d("2025-01-01"), to: d("2025-12-31"), accountIds: [acc["1020"]!] });
    expect(gl.accounts).toHaveLength(1);
    const bank = gl.accounts[0]!;
    expect(bank.opening.toFixed(2)).toBe("1000.00");
    expect(bank.lines.map((l) => l.balance.toFixed(2))).toEqual(["1500.00", "1300.00"]);
    expect(bank.closing.toFixed(2)).toBe("1300.00");
  });

  it("pearaamat näitab valitud kontot ka liikumiseta", async () => {
    const gl = await generalLedger(db, companyId, { from: d("2026-05-01"), to: d("2026-05-31"), accountIds: [acc["1020"]!] });
    expect(gl.accounts[0]!.lines).toHaveLength(0);
    expect(gl.accounts[0]!.closing.toFixed(2)).toBe("1300.00");
  });

  it("päevaraamat: ainult postitatud kanded perioodis", async () => {
    const book = await dayBook(db, companyId, { from: d("2026-01-01"), to: d("2026-12-31") });
    expect(book.total).toBe(2);
    expect(book.entries.every((e) => e.status === "POSTED")).toBe(true);
  });

  it("osakonna filter", async () => {
    const dep = await db.department.create({ data: { companyId, code: "A", name: "A" } });
    await db.$transaction((tx) =>
      postJournalEntry(tx, companyId, userId, {
        date: d("2026-04-01"),
        source: "MANUAL",
        lines: [
          { accountId: acc["4190"]!, debit: "50", departmentId: dep.id },
          { accountId: acc["1020"]!, credit: "50" },
        ],
      }),
    );
    const tb = await trialBalance(db, companyId, { from: d("2026-01-01"), to: d("2026-12-31"), departmentId: dep.id });
    expect(tb.rows.map((r) => r.code)).toEqual(["4190"]);
  });
});
