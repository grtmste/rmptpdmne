import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/prisma";
import { scopeArgs, scopeToCompany, TENANT_MODELS, TenantViolationError } from "@/lib/tenant";
import { createCompanyForUser, createUserWithOrganization } from "@/server/services/accounts";
import { resetDatabase } from "./helpers";

const db = createPrismaClient();

let companyA: string;
let companyB: string;
let userId: string;

beforeAll(async () => {
  await resetDatabase(db);
  const { user, organization } = await createUserWithOrganization(db, {
    email: "tenant@test.ee",
    name: "Test",
    passwordHash: null,
    locale: "et",
    organizationName: "Büroo",
  });
  userId = user.id;
  companyA = (await createCompanyForUser(db, user.id, organization.id, { name: "A OÜ", regCode: "10000001", vatNumber: null })).id;
  companyB = (await createCompanyForUser(db, user.id, organization.id, { name: "B OÜ", regCode: "10000002", vatNumber: null })).id;
  await db.notification.createMany({
    data: [
      { companyId: companyA, kind: "system", title: "A1" },
      { companyId: companyA, kind: "system", title: "A2" },
      { companyId: companyB, kind: "system", title: "B1" },
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("TENANT_MODELS vastab skeemile", () => {
  it("iga companyId väljaga mudel on nimekirjas ja vastupidi", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+companyId\s+String/m.test(body!))
      .map(([, name]) => name)
      .sort();
    expect(models).toEqual([...TENANT_MODELS].sort());
  });
});

describe("companyDb isolatsioon", () => {
  it("findMany ja count näevad ainult oma ettevõtet", async () => {
    const a = scopeToCompany(db, companyA);
    const rows = await a.notification.findMany();
    expect(rows.map((r) => r.title).sort()).toEqual(["A1", "A2"]);
    expect(await a.notification.count()).toBe(2);
    // Ka siis, kui päring küsib otse teist ettevõtet
    expect(await a.notification.findMany({ where: { companyId: companyB } })).toHaveLength(0);
  });

  it("findUnique ei leia teise ettevõtte kirjet", async () => {
    const b1 = await db.notification.findFirstOrThrow({ where: { companyId: companyB } });
    const a = scopeToCompany(db, companyA);
    expect(await a.notification.findUnique({ where: { id: b1.id } })).toBeNull();
    await expect(a.notification.findUniqueOrThrow({ where: { id: b1.id } })).rejects.toThrow();
  });

  it("update ja delete ei muuda teise ettevõtte kirjet", async () => {
    const b1 = await db.notification.findFirstOrThrow({ where: { companyId: companyB } });
    const a = scopeToCompany(db, companyA);
    await expect(a.notification.update({ where: { id: b1.id }, data: { title: "häkitud" } })).rejects.toThrow();
    await expect(a.notification.delete({ where: { id: b1.id } })).rejects.toThrow();
    expect((await a.notification.updateMany({ data: { body: "x" } })).count).toBe(2);
    expect((await db.notification.findUniqueOrThrow({ where: { id: b1.id } })).title).toBe("B1");
    expect((await db.notification.findUniqueOrThrow({ where: { id: b1.id } })).body).toBeNull();
  });

  it("aggregate ja groupBy on piiratud", async () => {
    const a = scopeToCompany(db, companyA);
    const agg = await a.notification.aggregate({ _count: { _all: true } });
    expect(agg._count._all).toBe(2);
    const groups = await a.notification.groupBy({ by: ["companyId"], _count: { _all: true } });
    expect(groups).toEqual([{ companyId: companyA, _count: { _all: 2 } }]);
  });

  it("create lisab companyId automaatselt ja keelab võõra", async () => {
    const a = scopeToCompany(db, companyA);
    const created = await a.notification.create({ data: { kind: "system", title: "A3" } as never });
    expect(created.companyId).toBe(companyA);
    await expect(
      a.notification.create({ data: { companyId: companyB, kind: "system", title: "X" } }),
    ).rejects.toBeInstanceOf(TenantViolationError);
    const many = await a.notification.createMany({ data: [{ kind: "system", title: "A4" }] as never });
    expect(many.count).toBe(1);
    expect(await db.notification.count({ where: { companyId: companyB } })).toBe(1);
  });

  it("companyId muutmine teise ettevõtte omaks on keelatud", async () => {
    const a = scopeToCompany(db, companyA);
    const a1 = await a.notification.findFirstOrThrow({ where: { title: "A1" } });
    await expect(a.notification.update({ where: { id: a1.id }, data: { companyId: companyB } })).rejects.toBeInstanceOf(
      TenantViolationError,
    );
  });

  it("upsert loob oma ettevõttesse", async () => {
    const a = scopeToCompany(db, companyA);
    const row = await a.notification.upsert({
      where: { id: "olematu" },
      create: { kind: "system", title: "upsert" } as never,
      update: {},
    });
    expect(row.companyId).toBe(companyA);
  });

  it("liikmesused ja kutsed on piiratud", async () => {
    const a = scopeToCompany(db, companyA);
    const memberships = await a.membership.findMany();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.companyId).toBe(companyA);
  });

  it("Company mudel näitab ainult aktiivset ettevõtet", async () => {
    const a = scopeToCompany(db, companyA);
    const companies = await a.company.findMany();
    expect(companies.map((c) => c.id)).toEqual([companyA]);
    expect(await a.company.findFirst({ where: { id: companyB } })).toBeNull();
    await expect(a.company.update({ where: { id: companyB }, data: { name: "X" } })).rejects.toThrow();
  });

  it("ettevõtteülesed mudelid on companyDb-s keelatud", async () => {
    const a = scopeToCompany(db, companyA);
    await expect(a.user.findMany()).rejects.toBeInstanceOf(TenantViolationError);
    await expect(a.organization.findMany()).rejects.toBeInstanceOf(TenantViolationError);
  });

  it("transaktsioonis kehtib sama piirang", async () => {
    const a = scopeToCompany(db, companyA);
    const count = await a.$transaction(async (tx) => tx.notification.count({ where: { companyId: companyB } }));
    expect(count).toBe(0);
  });

  it("kasutaja on mõlema ettevõtte omanik, aga andmed ei segune", async () => {
    const b = scopeToCompany(db, companyB);
    expect(await b.notification.count()).toBe(1);
    expect(await b.membership.count({ where: { userId } })).toBe(1);
  });
});

describe("scopeArgs", () => {
  it("lisab companyId olemasolevale where tingimusele", () => {
    expect(scopeArgs("Notification", "findMany", { where: { title: "x" } }, "c1")).toEqual({
      where: { title: "x", AND: [{ companyId: "c1" }] },
    });
  });
  it("säilitab olemasoleva AND tingimuse", () => {
    expect(scopeArgs("Notification", "findMany", { where: { AND: { title: "x" } } }, "c1").where).toEqual({
      AND: [{ title: "x" }, { companyId: "c1" }],
    });
  });
  it("keelab company seose kasutamise", () => {
    expect(() =>
      scopeArgs("Notification", "create", { data: { company: { connect: { id: "c2" } } } }, "c1"),
    ).toThrow(TenantViolationError);
  });
});
