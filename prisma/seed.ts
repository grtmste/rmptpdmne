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
  const created = [];
  for (const u of users) {
    const user = await db.user.create({ data: { email: u.email, name: u.name, passwordHash, emailVerified: new Date() } });
    await db.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: u.role === "OWNER" ? "ADMIN" : "MEMBER" },
    });
    created.push({ ...u, id: user.id });
  }

  for (const c of companies) {
    const company = await db.company.create({
      data: { ...c, organizationId: organization.id, isDemo: true, createdById: created[0]!.id },
    });
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

  console.info(`Demoandmed loodud. Logi sisse nt ${users[0]!.email} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
