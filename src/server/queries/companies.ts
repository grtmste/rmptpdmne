import "server-only";
import { db } from "@/lib/db";
import type { CompanyRole } from "@/lib/permissions";

export type CompanySummary = {
  id: string;
  name: string;
  regCode: string | null;
  role: CompanyRole;
  lastAccessedAt: Date | null;
  isDemo: boolean;
};

/** Kasutaja ettevõtted, viimati kasutatud eespool. */
export async function listUserCompanies(userId: string): Promise<CompanySummary[]> {
  const rows = await db.membership.findMany({
    where: { userId, company: { archivedAt: null } },
    orderBy: [{ lastAccessedAt: { sort: "desc", nulls: "last" } }, { company: { name: "asc" } }],
    select: {
      role: true,
      lastAccessedAt: true,
      company: { select: { id: true, name: true, regCode: true, isDemo: true } },
    },
  });
  return rows.map((r) => ({
    id: r.company.id,
    name: r.company.name,
    regCode: r.company.regCode,
    isDemo: r.company.isDemo,
    role: r.role,
    lastAccessedAt: r.lastAccessedAt,
  }));
}

export async function canCreateCompany(userId: string): Promise<boolean> {
  const count = await db.organizationMember.count({ where: { userId, role: "ADMIN" } });
  return count > 0;
}
