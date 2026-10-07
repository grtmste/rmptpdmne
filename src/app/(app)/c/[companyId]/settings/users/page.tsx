import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { parseOverrides } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/common/page-header";
import { UsersManager, type InvitationRow, type MemberRow } from "./users-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.users") };
}

export default async function UsersPage({ params, searchParams }: PageProps<"/c/[companyId]/settings/users">) {
  const { companyId } = await params;
  const { invite } = await searchParams;
  const ctx = await requireCompany(companyId, "users", "confirm");
  const t = await getTranslations("users");
  const locale = await getLocale();

  const [members, invitations] = await Promise.all([
    ctx.cdb.membership.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        permissions: true,
        lastAccessedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    ctx.cdb.invitation.findMany({
      where: { status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);

  const memberRows: MemberRow[] = members.map((m) => ({
    id: m.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    permissions: parseOverrides(m.permissions),
    isSelf: m.user.id === ctx.user.id,
    lastAccessed: m.lastAccessedAt ? formatDate(m.lastAccessedAt, locale) : null,
  }));
  const invitationRows: InvitationRow[] = invitations.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expires: formatDate(i.expiresAt, locale),
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle", { company: ctx.company.name })} />
      <UsersManager
        companyId={companyId}
        members={memberRows}
        invitations={invitationRows}
        openInvite={invite === "1"}
      />
    </div>
  );
}
