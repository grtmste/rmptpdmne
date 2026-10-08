import type { PrismaClient } from "@/lib/prisma";
import { ensureCompanyDefaults } from "./company-setup";
import type { CompanyRole } from "@/lib/permissions";

/**
 * Kasutajate, organisatsioonide ja ettevõtete loomise äriloogika. Ei sõltu Next.js-ist,
 * seega kasutatav nii Server Actionites, seed-skriptis kui testides.
 */

export async function createUserWithOrganization(
  db: PrismaClient,
  input: { email: string; name: string | null; passwordHash: string | null; locale: string; organizationName: string },
) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash: input.passwordHash, locale: input.locale },
    });
    const organization = await tx.organization.create({
      data: { name: input.organizationName, members: { create: { userId: user.id, role: "ADMIN" } } },
    });
    return { user, organization };
  });
}

export type NewCompanyInput = {
  name: string;
  regCode: string | null;
  vatNumber: string | null;
  isDemo?: boolean;
  /** Arvestuse algus; vaikimisi jooksva aasta 1. jaanuar */
  accountingStartDate?: Date;
};

/**
 * Loob ettevõtte kasutaja organisatsiooni alla ja teeb kasutaja selle omanikuks.
 * Kasutaja peab olema organisatsiooni ADMIN.
 */
export async function createCompanyForUser(
  db: PrismaClient,
  userId: string,
  organizationId: string,
  input: NewCompanyInput,
) {
  return db.$transaction(
    async (tx) => {
      const orgMember = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });
      if (!orgMember || orgMember.role !== "ADMIN") throw new Error("forbidden");
      const company = await tx.company.create({
        data: {
          organizationId,
          name: input.name,
          regCode: input.regCode,
          vatNumber: input.vatNumber,
          isDemo: input.isDemo ?? false,
          accountingStartDate: input.accountingStartDate,
          createdById: userId,
          memberships: { create: { userId, role: "OWNER", lastAccessedAt: new Date() } },
        },
      });
      await ensureCompanyDefaults(tx, company.id, { userId });
      await tx.auditLog.create({
        data: {
          companyId: company.id,
          userId,
          action: "company.create",
          entityType: "Company",
          entityId: company.id,
          diff: { after: { name: company.name, regCode: company.regCode, vatNumber: company.vatNumber } },
        },
      });
      return company;
    },
    { timeout: 20_000 },
  );
}

/** Kasutaja organisatsioon, kuhu uus ettevõte luuakse (esimene, kus ta on ADMIN). */
export async function adminOrganizationFor(db: PrismaClient, userId: string) {
  const member = await db.organizationMember.findFirst({
    where: { userId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return member?.organizationId ?? null;
}

/** Kas ettevõttes jääb pärast muudatust alles vähemalt üks omanik. */
export async function wouldRemoveLastOwner(
  db: PrismaClient,
  companyId: string,
  membershipId: string,
  newRole: CompanyRole | null,
) {
  if (newRole === "OWNER") return false;
  const target = await db.membership.findFirst({ where: { id: membershipId, companyId } });
  if (!target || target.role !== "OWNER") return false;
  const owners = await db.membership.count({ where: { companyId, role: "OWNER" } });
  return owners <= 1;
}
