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
import { addDays, parseISODate } from "../src/lib/accounting/dates";
import { todayLocal } from "../src/lib/dates";
import { ensureCompanyDefaults } from "../src/server/services/company-setup";
import { postJournalEntry } from "../src/server/services/journal";
import { confirmInvoice, saveInvoiceDraft, saveQuote } from "../src/server/services/sales";
import { confirmExpenseReport, confirmPurchase, saveExpenseReport, savePurchaseDraft, savePurchaseOrder } from "../src/server/services/purchases";

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

  // Müük (faas 3): arve seadistus, kliendid, artiklid, arved ja pakkumine
  await db.company.update({
    where: { id: first.id },
    data: {
      invoiceBankDetails: "LHV Pank EE717700771001234567",
      invoiceNote: "Täname koostöö eest!",
      invoiceFooter: "Lilleaed OÜ · aiad, mis rõõmustavad",
      phone: "+372 5555 1234",
    },
  });
  const vat = Object.fromEntries(
    (await db.vatRate.findMany({ where: { companyId: first.id } })).map((v) => [v.code, v.id]),
  ) as Record<string, string>;
  const group = await db.customerGroup.create({ data: { companyId: first.id, name: "Püsikliendid" } });
  const [kool, kohvik, eraisik] = await Promise.all([
    db.customer.create({
      data: {
        companyId: first.id,
        name: "Tartu Kunstikool",
        regCode: "75012345",
        email: "arved@kunstikool.example",
        addressStreet: "Kunsti 3",
        addressCity: "Tartu",
        addressPostalCode: "51003",
        groupId: group.id,
      },
    }),
    db.customer.create({
      data: {
        companyId: first.id,
        name: "Kohvik Roheline OÜ",
        regCode: "14567890",
        vatNumber: "EE101234567",
        email: "raamatupidamine@roheline.example",
        addressStreet: "Rüütli 10",
        addressCity: "Tartu",
        paymentTermDays: 7,
      },
    }),
    db.customer.create({ data: { companyId: first.id, name: "Liis Lepp", isPerson: true, email: "liis@example.com", locale: "et" } }),
  ]);
  const itemGroup = await db.itemGroup.create({ data: { companyId: first.id, name: "Aiatööd" } });
  const items = await Promise.all(
    [
      { code: "KUJ", name: "Aiakujunduse projekt", unit: "tk", salePrice: "450", type: "SERVICE" as const },
      { code: "HOOL", name: "Aiahooldus", unit: "h", salePrice: "35", type: "SERVICE" as const },
      { code: "ROOS", name: "Roosipõõsas", unit: "tk", salePrice: "18.50", purchasePrice: "9.20", type: "GOODS" as const },
      { code: "MULD", name: "Aiamuld 50 l", unit: "kott", salePrice: "7.90", purchasePrice: "3.10", type: "GOODS" as const },
    ].map((i) =>
      db.item.create({
        data: {
          companyId: first.id,
          ...i,
          vatRateId: vat.KM,
          salesAccountId: i.type === "GOODS" ? acc["3000"] : acc["3010"],
          groupId: itemGroup.id,
        },
      }),
    ),
  );
  const [kuj, hool, roos, muld] = items;
  const today = todayLocal();
  const owner = created[0]!.id;
  // Kuupäevad jäävad majandusaasta sisse ka aasta alguses
  const ago = (days: number) => {
    const d = addDays(today, -days);
    return d < startDate ? startDate : d;
  };
  const invoices = [
    {
      customerId: kool.id,
      date: ago(40),
      lines: [
        { itemId: kuj!.id, description: kuj!.name, quantity: "1", unitPrice: "450", vatRateId: vat.KM },
        { itemId: hool!.id, description: "Aiahooldus, september", quantity: "12", unitPrice: "35", vatRateId: vat.KM },
      ],
    },
    {
      customerId: kohvik.id,
      date: ago(12),
      lines: [
        { itemId: roos!.id, description: roos!.name, quantity: "10", unitPrice: "18.50", vatRateId: vat.KM },
        { itemId: muld!.id, description: muld!.name, quantity: "6", unitPrice: "7.90", vatRateId: vat.KM, discountPct: "10" },
      ],
    },
    {
      customerId: eraisik.id,
      date: ago(3),
      lines: [{ itemId: hool!.id, description: "Muru niitmine ja hekilõikus", quantity: "4.5", unitPrice: "35", vatRateId: vat.KM }],
    },
  ];
  for (const inv of invoices) {
    await db.$transaction(
      async (tx) => {
        const id = await saveInvoiceDraft(tx, first.id, owner, { type: "INVOICE", pricesIncludeVat: false, ...inv });
        await confirmInvoice(tx, first.id, owner, id);
      },
      { timeout: 30_000 },
    );
  }
  await db.$transaction((tx) =>
    saveInvoiceDraft(tx, first.id, owner, {
      type: "INVOICE",
      customerId: kohvik.id,
      date: today,
      pricesIncludeVat: false,
      lines: [{ itemId: hool!.id, description: "Terrassi lillekastide istutus", quantity: "3", unitPrice: "35", vatRateId: vat.KM }],
    }),
  );
  await db.$transaction((tx) =>
    saveQuote(tx, first.id, owner, {
      customerId: kool.id,
      date: ago(2),
      validUntil: addDays(today, 12),
      pricesIncludeVat: false,
      notes: "Hinnad sisaldavad materjale ja tööd.",
      lines: [
        { itemId: kuj!.id, description: "Sisehoovi kujundusprojekt", quantity: "1", unitPrice: "450", vatRateId: vat.KM },
        { itemId: roos!.id, description: roos!.name, quantity: "24", unitPrice: "18.50", vatRateId: vat.KM },
      ],
    }),
  );

  // Ost (faas 4): tarnijad, ostuarved, tellimus ja kuluaruanne
  const [taimla, telia] = await Promise.all([
    db.supplier.create({
      data: {
        companyId: first.id,
        name: "Taimla Puukool OÜ",
        regCode: "10987654",
        vatNumber: "EE100987654",
        bankAccount: "EE382200221020145685",
        defaultAccountId: acc["4010"],
        paymentTermDays: 14,
      },
    }),
    db.supplier.create({
      data: { companyId: first.id, name: "Sidefirma AS", regCode: "10234567", bankAccount: "EE471000001020145685", defaultAccountId: acc["4150"] },
    }),
  ]);
  const purchases = [
    {
      supplierId: taimla.id,
      invoiceNumber: "TP-2291",
      date: ago(30),
      lines: [{ description: "Roosipõõsad 40 tk", quantity: "40", unitPrice: "9.20", vatRateId: vat.KM }],
    },
    {
      supplierId: telia.id,
      invoiceNumber: "S-88123",
      date: ago(8),
      lines: [{ description: "Internet ja mobiil", quantity: "1", unitPrice: "39.90", vatRateId: vat.KM }],
    },
  ];
  for (const p of purchases) {
    await db.$transaction(
      async (tx) => {
        const id = await savePurchaseDraft(tx, first.id, owner, { pricesIncludeVat: false, ...p });
        await confirmPurchase(tx, first.id, owner, id);
      },
      { timeout: 30_000 },
    );
  }
  await db.$transaction((tx) =>
    savePurchaseOrder(tx, first.id, owner, {
      supplierId: taimla.id,
      date: ago(1),
      expectedDate: addDays(today, 6),
      pricesIncludeVat: false,
      lines: [{ description: "Hortensiad 15 tk", quantity: "15", unitPrice: "12.50", vatRateId: vat.KM, accountId: acc["4010"] }],
    }),
  );
  const employee = await db.employee.create({ data: { companyId: first.id, name: "Mari Maasikas", bankAccount: "EE471000001020145685" } });
  await db.$transaction(
    async (tx) => {
      const id = await saveExpenseReport(tx, first.id, owner, {
        employeeId: employee.id,
        date: ago(5),
        description: "Messikülastus",
        lines: [
          { date: ago(7), vendor: "Rimi", description: "Kohv ja küpsised", grossAmount: "18.60", vatRateId: vat.KM, accountId: acc["4190"] },
          { date: ago(6), vendor: "Parkla AS", description: "Parkimine", grossAmount: "6.00", vatRateId: vat.KM, accountId: acc["4120"] },
        ],
      });
      await confirmExpenseReport(tx, first.id, owner, id);
    },
    { timeout: 30_000 },
  );

  console.info(`Demoandmed loodud. Logi sisse nt ${users[0]!.email} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
