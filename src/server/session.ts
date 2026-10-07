import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { scopeToCompany, type CompanyDb } from "@/lib/tenant";
import {
  can,
  effectivePermissions,
  type CompanyRole,
  type Level,
  type Module,
  type PermissionMap,
} from "@/lib/permissions";

/**
 * Andmetele ligipääsu kiht (DAL): sessioon, kasutaja ja ettevõtte kontekst.
 * Iga leht ja Server Action loeb kasutaja siit, mitte otse küpsisest.
 */

export type CurrentUser = { id: string; email: string; name: string | null; locale: string };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, locale: true },
  });
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type CompanyContext = {
  user: CurrentUser;
  company: {
    id: string;
    name: string;
    regCode: string | null;
    vatNumber: string | null;
    organizationId: string;
    baseCurrency: string;
  };
  membership: { id: string; role: CompanyRole; permissions: unknown };
  permissions: PermissionMap;
  /** Ettevõttega piiratud Prisma klient */
  cdb: CompanyDb;
};

/** Laeb ettevõtte konteksti. Kui kasutaja ei ole ettevõtte liige, tagastab null. */
export const loadCompanyContext = cache(async (companyId: string): Promise<CompanyContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const membership = await db.membership.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
    select: {
      id: true,
      role: true,
      permissions: true,
      company: {
        select: {
          id: true,
          name: true,
          regCode: true,
          vatNumber: true,
          organizationId: true,
          baseCurrency: true,
          archivedAt: true,
        },
      },
    },
  });
  if (!membership || membership.company.archivedAt) return null;
  const { id, name, regCode, vatNumber, organizationId, baseCurrency } = membership.company;
  return {
    user,
    company: { id, name, regCode, vatNumber, organizationId, baseCurrency },
    membership: { id: membership.id, role: membership.role, permissions: membership.permissions },
    permissions: effectivePermissions(membership.role, membership.permissions),
    cdb: scopeToCompany(db, companyId),
  };
});

/**
 * Lehtede jaoks: nõuab sisselogimist ja liikmesust. Teise ettevõtte ID korral 404
 * (ei paljasta, kas ettevõte on olemas).
 */
export async function requireCompany(companyId: string, module?: Module, level: Level = "view") {
  await requireUser();
  const ctx = await loadCompanyContext(companyId);
  if (!ctx) notFound();
  if (module && !can(ctx.membership, module, level)) {
    redirect(`/c/${companyId}?denied=${module}`);
  }
  return ctx;
}

/** Jätab meelde viimati kasutatud ettevõtte (ettevõtte vahetaja järjestus). */
export async function touchCompany(userId: string, companyId: string) {
  // Uuendame kõige rohkem kord minutis, et iga navigeerimine ei kirjutaks andmebaasi.
  const threshold = new Date(Date.now() - 60_000);
  await db.membership.updateMany({
    where: { userId, companyId, OR: [{ lastAccessedAt: null }, { lastAccessedAt: { lt: threshold } }] },
    data: { lastAccessedAt: new Date() },
  });
}
