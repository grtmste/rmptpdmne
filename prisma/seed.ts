/**
 * Demoandmed: üks raamatupidamisbüroo, kaks ettevõtet ja kasutaja igas rollis.
 * Käivita: pnpm db:seed (kordne käivitamine on ohutu – olemasolevaid kasutajaid ei dubleerita).
 *
 * Kõigi demokasutajate parool: demo-parool-123
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import type { CompanyRole } from "../src/lib/permissions";
import { parseISODate } from "../src/lib/accounting/dates";
import { ensureCompanyDefaults } from "../src/server/services/company-setup";
import { postJournalEntry } from "../src/server/services/journal";

const db = createPrismaClient();
const PASSWORD = "demo-parool-123";

const users: Array<{ email: string; name: string; role: CompanyRole }> = [
  { email: "omanik@demo.ee", name: "Mari Maasikas", role: "OWNER" },
  { email: "raamatupidaja@demo.ee", name: "Jaan Tamm", role: "ACCOUNTANT" },
  { email: "koostaja@demo.ee", name: "Kati Kask", role: "EDITOR" },
  { email: "vaataja@demo.ee", name: "Peeter Paju", role: "VIEWER" },
];

const companies = [
  { name: "Lilleaed OÜ", regCode: "16000001", vatNumber: "EE102000001" },
  { name: "Põhjatuul AS", regCode: "16000002", vatNumber: null },
];

async function main() {
  const existing = await db.user.findUnique({ where: { email: users[0]!.email } });
  if (existing) {
    console.info("Demoandmed on juba olemas – jätan vahele.");
    return;
  }
  const passwordHash = await hashPassword(PASSWORD);

  const organization = await db.organization.create({ data: { name: "Demo Raamatupidamisbüroo" } });
  const created: Array<(typeof users)[number] & { id: string }> = [];
  for (const u of users) {
    const user = await db.user.create({ data: { email: u.email, name: u.name, passwordHash, emailVerified: new Date() } });
    await db.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: u.role === "OWNER" ? "ADMIN" : "MEMBER" },
    });
    created.push({ ...u, id: user.id });
  }

  const year = new Date().getUTCFullYear();
  const startDate = parseISODate(`${year}-01-01`)!;
  for (const [index, c] of companies.entries()) {
    const company = await db.company.create({
      data: {
        ...c,
        organizationId: organization.id,
        isDemo: true,
        accountingStartDate: startDate,
        addressStreet: index === 0 ? "Lille tn 5" : "Tuule tee 12",
        addressCity: index === 0 ? "Tartu" : "Tallinn",
        addressPostalCode: index === 0 ? "50101" : "10111",
        email: index === 0 ? "info@lilleaed.example" : "info@pohjatuul.example",
        createdById: created[0]!.id,
      },
    });
    await db.$transaction((tx) => ensureCompanyDefaults(tx, company.id, { userId: created[0]!.id }), { timeout: 30_000 });
    await db.membership.createMany({
      data: created.map((u) => ({ userId: u.id, companyId: company.id, role: u.role })),
    });
    await db.notification.createMany({
      data: [
        {
          companyId: company.id,
          kind: "system",
          title: "Tere tulemast LILY SOKID-i!",
          body: "See on demoettevõte. Proovi julgelt – andmed on näidisandmed.",
        },
        {
          companyId: company.id,
          kind: "system",
          title: "Kiirotsing",
          body: "Vajuta Ctrl+K (Macis ⌘K), et otsida vaateid ja teha toiminguid.",
        },
      ],
    });
    await db.auditLog.create({
      data: {
        companyId: company.id,
        userId: created[0]!.id,
        action: "company.create",
        entityType: "Company",
        entityId: company.id,
        diff: { after: c },
      },
    });
  }

  // Esimesele ettevõttele projektid, osakond ja algsaldod
  const first = await db.company.findFirstOrThrow({ where: { name: companies[0]!.name } });
  const project = await db.dimension.findFirstOrThrow({ where: { companyId: first.id, name: "Projekt" } });
  await db.dimensionValue.createMany({
    data: [
      { companyId: first.id, dimensionId: project.id, code: "AED", name: "Aiakujundus" },
      { companyId: first.id, dimensionId: project.id, code: "KIRIK", name: "Kirikuaia hooldus" },
    ],
  });
  await db.department.create({ data: { companyId: first.id, code: "TRT", name: "Tartu kontor" } });
  const acc = Object.fromEntries(
    (await db.glAccount.findMany({ where: { companyId: first.id } })).map((a) => [a.code, a.id]),
  ) as Record<string, string>;
  await db.$transaction((tx) =>
    postJournalEntry(tx, first.id, created[0]!.id, {
      date: parseISODate(`${year - 1}-12-31`)!,
      source: "OPENING_BALANCE",
      description: "Algsaldod",
      lines: [
        { accountId: acc["1020"]!, debit: "12480.35" },
        { accountId: acc["1000"]!, debit: "150.00" },
        { accountId: acc["1200"]!, debit: "3420.00" },
        { accountId: acc["1740"]!, debit: "4800.00" },
        { accountId: acc["1790"]!, credit: "1600.00" },
        { accountId: acc["2110"]!, credit: "1870.40" },
        { accountId: acc["2320"]!, credit: "640.00" },
        { accountId: acc["2900"]!, credit: "2500.00" },
        { accountId: acc["2950"]!, credit: "14239.95" },
      ],
    }),
  );

  console.info(`Demoandmed loodud. Logi sisse nt ${users[0]!.email} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
