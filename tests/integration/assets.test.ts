import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { dec } from "@/lib/money";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import {
  AssetError,
  cancelDepreciationRun,
  deleteAsset,
  disposeAsset,
  previewDepreciation,
  reclassifyAsset,
  revalueAsset,
  runDepreciation,
  saveAsset,
} from "@/server/services/assets";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();
const d = (s: string) => parseISODate(s)!;
let companyId: string;
let userId: string;
const acc: Record<string, string> = {};
const group: Record<string, string> = {};
let laptop: string;
let machine: string;

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "pohivara@test.ee",
    name: "Põhivara",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyId = (await createCompanyForUser(db, user.id, organization.id, { name: "Vara OÜ", regCode: "99999999", vatNumber: null, accountingStartDate: d("2026-01-01") })).id;
  for (const a of await db.glAccount.findMany({ where: { companyId } })) acc[a.code] = a.id;
  for (const g of await db.fixedAssetGroup.findMany({ where: { companyId } })) group[g.name] = g.id;
});

afterAll(async () => {
  await db.$disconnect();
});

async function balance(code: string) {
  const r = await db.journalLine.aggregate({ where: { companyId, accountId: acc[code], entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return dec(r._sum.debit ?? 0).minus(dec(r._sum.credit ?? 0)).toFixed(2);
}

describe("register", () => {
  it("ettevõttel on vaikimisi grupid kontodega", async () => {
    expect(Object.keys(group)).toContain("Inventar ja arvutid");
    const g = await db.fixedAssetGroup.findUniqueOrThrow({ where: { id: group["Inventar ja arvutid"] } });
    expect([g.assetAccountId, g.accumulatedAccountId, g.expenseAccountId, g.usefulLifeMonths]).toEqual([acc["1740"], acc["1790"], acc["4300"], 36]);
  });

  it("lisab vara grupi kontodega ja kontrollib väärtusi", async () => {
    laptop = await db.$transaction((tx) =>
      saveAsset(tx, companyId, userId, {
        code: "PV-1",
        name: "Sülearvuti",
        groupId: group["Inventar ja arvutid"]!,
        acquisitionDate: d("2026-01-15"),
        depreciationStart: d("2026-02-10"),
        cost: "1800",
        usefulLifeMonths: 36,
      }),
    );
    const a = await db.fixedAsset.findUniqueOrThrow({ where: { id: laptop } });
    expect([toISODate(a.depreciationStart), a.assetAccountId, a.expenseAccountId]).toEqual(["2026-02-01", acc["1740"], acc["4300"]]);
    const err = await db
      .$transaction((tx) => saveAsset(tx, companyId, userId, { code: "PV-X", name: "X", groupId: group["Inventar ja arvutid"]!, acquisitionDate: d("2026-03-01"), depreciationStart: d("2026-02-01"), cost: "100", usefulLifeMonths: 12 }))
      .catch((e) => e);
    expect(err).toMatchObject({ code: "startBeforeAcquisition" });
    // Üle toodud vara: 2024 soetatud, 24 kuud ja 4800 juba arvestatud
    machine = await db.$transaction((tx) =>
      saveAsset(tx, companyId, userId, {
        code: "PV-2",
        name: "Freespink",
        groupId: group["Masinad ja seadmed"]!,
        acquisitionDate: d("2024-01-10"),
        depreciationStart: d("2024-01-01"),
        cost: "12000",
        residualValue: "0",
        usefulLifeMonths: 60,
        openingDepreciation: "4800",
        openingMonths: 24,
      }),
    );
  });
});

describe("kulum", () => {
  it("jaanuaris ainult järeleaitav masin, veebruarist ka arvuti", async () => {
    const jan = await db.$transaction((tx) => previewDepreciation(tx, companyId, d("2026-01-01")));
    expect(jan.map((r) => [r.code, r.months, r.amount.toFixed(2)])).toEqual([["PV-2", 1, "200.00"]]);
    const run = await db.$transaction((tx) => runDepreciation(tx, companyId, userId, d("2026-01-01")));
    expect(run.total.toFixed(2)).toBe("200.00");
    const feb = await db.$transaction((tx) => runDepreciation(tx, companyId, userId, d("2026-02-15")));
    // 1800 / 36 = 50
    expect(feb.total.toFixed(2)).toBe("250.00");
    const r = await db.depreciationRun.findUniqueOrThrow({ where: { id: feb.id } });
    expect(toISODate(r.date)).toBe("2026-02-28");
    expect(await balance("4300")).toBe("450.00");
    expect(await balance("1790")).toBe("-450.00");
  });

  it("sama kuud ega vahelejäetud varasemat kuud uuesti ei arvestata; tühistada saab viimase", async () => {
    await expect(db.$transaction((tx) => runDepreciation(tx, companyId, userId, d("2026-02-01")))).rejects.toMatchObject({ code: "runExists" });
    const mar = await db.$transaction((tx) => runDepreciation(tx, companyId, userId, d("2026-03-01")));
    const jan = await db.depreciationRun.findFirstOrThrow({ where: { companyId, period: d("2026-01-01") } });
    await expect(db.$transaction((tx) => cancelDepreciationRun(tx, companyId, jan.id))).rejects.toMatchObject({ code: "notLatestRun" });
    await db.$transaction((tx) => cancelDepreciationRun(tx, companyId, mar.id));
    expect(await db.depreciationRun.count({ where: { companyId } })).toBe(2);
    expect(await balance("4300")).toBe("450.00");
    // Ajalooga vara rahalisi andmeid ei muudeta, nime saab
    const a = await db.fixedAsset.findUniqueOrThrow({ where: { id: laptop } });
    const base = { code: a.code, groupId: a.groupId, acquisitionDate: a.acquisitionDate, depreciationStart: a.depreciationStart, cost: a.cost.toString(), usefulLifeMonths: a.usefulLifeMonths };
    await expect(db.$transaction((tx) => saveAsset(tx, companyId, userId, { ...base, id: laptop, name: "Sülearvuti", cost: "2000" }))).rejects.toMatchObject({ code: "financialLocked" });
    await db.$transaction((tx) => saveAsset(tx, companyId, userId, { ...base, id: laptop, name: "Sülearvuti (raamatupidaja)" }));
    await expect(db.$transaction((tx) => deleteAsset(tx, companyId, laptop))).rejects.toBeInstanceOf(AssetError);
  });
});

describe("muutused", () => {
  it("ümberhindamine muudab edasist kulumit", async () => {
    // Arvuti: 1 kuu tehtud (50), jääk 1750 / 35 kuud. Hind tõuseb 2150-ni ja eluiga 48 kuuni → (2150 − 50) / 47
    await expect(db.$transaction((tx) => revalueAsset(tx, companyId, userId, { assetId: laptop, date: d("2026-02-10"), newCost: "2150" }))).rejects.toMatchObject({
      code: "dateBeforeDepreciation",
    });
    await expect(db.$transaction((tx) => revalueAsset(tx, companyId, userId, { assetId: laptop, date: d("2026-03-01"), newCost: "2150" }))).rejects.toMatchObject({
      code: "counterAccountRequired",
    });
    await db.$transaction((tx) => revalueAsset(tx, companyId, userId, { assetId: laptop, date: d("2026-03-01"), newCost: "2150", usefulLifeMonths: 48, counterAccountId: acc["4010"] }));
    expect(await balance("1740")).toBe("350.00");
    const mar = await db.$transaction((tx) => previewDepreciation(tx, companyId, d("2026-03-01")));
    expect(mar.find((r) => r.code === "PV-1")!.amount.toFixed(2)).toBe("44.68");
  });

  it("ümberklassifitseerimine kannab soetusmaksumuse ja kulumi uutele kontodele", async () => {
    await db.$transaction((tx) => reclassifyAsset(tx, companyId, userId, { assetId: laptop, date: d("2026-03-05"), groupId: group["Masinad ja seadmed"]! }));
    const a = await db.fixedAsset.findUniqueOrThrow({ where: { id: laptop } });
    expect([a.groupId, a.assetAccountId]).toEqual([group["Masinad ja seadmed"], acc["1720"]]);
    // 1740 tühjaks, 1720-le 2150 juurde (akumuleeritud kulumi konto on sama 1790)
    expect(await balance("1740")).toBe("-1800.00");
    expect(await balance("1720")).toBe("2150.00");
    await expect(db.$transaction((tx) => reclassifyAsset(tx, companyId, userId, { assetId: laptop, date: d("2026-03-05"), groupId: group["Masinad ja seadmed"]! }))).rejects.toMatchObject({
      code: "sameGroup",
    });
  });

  it("mahakandmine viib jääkväärtuse kulusse ja vara ei saa enam kulumit", async () => {
    // Masin: 4800 + 200 (jaan) + 200 (veebr) = 5200 kulumit, jääk 6800
    const r = await db.$transaction((tx) => disposeAsset(tx, companyId, userId, { assetId: machine, date: d("2026-03-20"), lossAccountId: acc["4420"]! }));
    expect(r.bookValue.toFixed(2)).toBe("6800.00");
    expect(await balance("4420")).toBe("6800.00");
    const a = await db.fixedAsset.findUniqueOrThrow({ where: { id: machine } });
    expect(a.status).toBe("DISPOSED");
    const mar = await db.$transaction((tx) => previewDepreciation(tx, companyId, d("2026-03-01")));
    expect(mar.map((x) => x.code)).toEqual(["PV-1"]);
    await expect(db.$transaction((tx) => disposeAsset(tx, companyId, userId, { assetId: machine, date: d("2026-03-21"), lossAccountId: acc["4420"]! }))).rejects.toMatchObject({
      code: "assetDisposed",
    });
    // Mahakantud vara kuu kulumit ei saa enam tühistada (hilisem muutus)
    const feb = await db.depreciationRun.findFirstOrThrow({ where: { companyId, period: d("2026-02-01") } });
    await expect(db.$transaction((tx) => cancelDepreciationRun(tx, companyId, feb.id))).rejects.toMatchObject({ code: "runHasLaterEvents" });
  });
});

describe("aruanded", () => {
  it("nimekiri, kulumiaruanne ja koondaruanne", async () => {
    const { assetList, assetSummary, depreciationReport } = await import("@/server/reports/assets");
    const list = await assetList(db, companyId, { date: d("2026-03-31") });
    expect(list.rows.map((r) => [r.code, r.cost.toFixed(2), r.accumulated.toFixed(2), r.bookValue.toFixed(2)])).toEqual([["PV-1", "2150.00", "50.00", "2100.00"]]);
    // Enne mahakandmist oli masin veel nimekirjas
    const feb = await assetList(db, companyId, { date: d("2026-02-28") });
    expect(feb.rows.find((r) => r.code === "PV-2")!.bookValue.toFixed(2)).toBe("6800.00");
    expect(feb.rows.find((r) => r.code === "PV-1")!.cost.toFixed(2)).toBe("1800.00");

    const dep = await depreciationReport(db, companyId, { from: d("2026-01-01"), to: d("2026-03-31") });
    expect(dep.total.toFixed(2)).toBe("450.00");

    const sum = await assetSummary(db, companyId, { from: d("2026-01-01"), to: d("2026-03-31") });
    const m = sum.rows.find((r) => r.group === "Masinad ja seadmed")!;
    const f = (k: keyof typeof m) => (m[k] as { toFixed(n: number): string }).toFixed(2);
    expect([f("openingCost"), f("additions"), f("revaluations"), f("disposals"), f("closingCost")]).toEqual(["12000.00", "1800.00", "350.00", "12000.00", "2150.00"]);
    expect([f("openingAccumulated"), f("depreciation"), f("accumulatedDisposals"), f("closingAccumulated")]).toEqual(["4800.00", "450.00", "5200.00", "50.00"]);
    expect([f("openingBookValue"), f("closingBookValue")]).toEqual(["7200.00", "2100.00"]);
  });
});
