import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { requireCompany, touchCompany } from "@/server/session";
import { canCreateCompany, listUserCompanies } from "@/server/queries/companies";

export async function generateMetadata({ params }: LayoutProps<"/c/[companyId]">): Promise<Metadata> {
  const { companyId } = await params;
  const { company } = await requireCompany(companyId);
  return { title: { default: company.name, template: `%s · ${company.name}` } };
}

export default async function CompanyLayout({ children, params }: LayoutProps<"/c/[companyId]">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId);
  const [companies, mayCreate, unreadCount] = await Promise.all([
    listUserCompanies(ctx.user.id),
    canCreateCompany(ctx.user.id),
    ctx.cdb.notification.count({ where: { readAt: null, OR: [{ userId: null }, { userId: ctx.user.id }] } }),
    touchCompany(ctx.user.id, companyId),
  ]);
  const collapsed = (await cookies()).get("sidebar_collapsed")?.value === "1";

  const current = companies.find((c) => c.id === companyId)!;
  const toShell = (c: (typeof companies)[number]) => ({
    id: c.id,
    name: c.name,
    regCode: c.regCode,
    role: c.role,
    isDemo: c.isDemo,
  });

  return (
    <AppShell
      company={toShell(current)}
      companies={companies.map(toShell)}
      permissions={ctx.permissions}
      user={{ name: ctx.user.name, email: ctx.user.email }}
      canCreateCompany={mayCreate}
      initialCollapsed={collapsed}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
