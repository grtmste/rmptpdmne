import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus, Users } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { countryName } from "@/lib/countries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { CustomerGroups } from "./customer-groups";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.customers") };
}

const PAGE_SIZE = 50;

export default async function CustomersPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/customers">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("customers");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const group = str(sp.group);
  const showInactive = str(sp.inactive) === "1";
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where: Prisma.CustomerWhereInput = {
    ...(showInactive ? {} : { active: true }),
    ...(group ? { groupId: group } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { regCode: { contains: q } },
            { vatNumber: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, customers, groups] = await Promise.all([
    ctx.cdb.customer.count({ where }),
    ctx.cdb.customer.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { group: { select: { name: true } }, _count: { select: { invoices: true } } },
    }),
    ctx.cdb.customerGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { customers: true } } } }),
  ]);
  const canEdit = can(ctx.membership, "sales", "edit");
  const base = `/c/${companyId}/sales/customers`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={tn("items.sales.customers")}
        description={t("listSubtitle")}
        actions={
          <>
            <CustomerGroups
              companyId={companyId}
              canEdit={canEdit}
              groups={groups.map((g) => ({ id: g.id, name: g.name, count: g._count.customers }))}
            />
            {canEdit && (
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus /> {t("new")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <ListSearch
        placeholder={t("search")}
        filters={[
          {
            name: "group",
            label: t("group"),
            options: [{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))],
          },
        ]}
        toggles={[{ name: "inactive", label: t("showInactive") }]}
      />
      <Card className="mt-4 overflow-hidden">
        {customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q || group ? t("noResults") : t("emptyTitle")}
            description={q || group ? undefined : t("emptyBody")}
            action={
              canEdit &&
              !q && (
                <Button asChild>
                  <Link href={`${base}/new`}>
                    <Plus /> {t("new")}
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("name")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("regCode")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium md:table-cell">{t("email")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium lg:table-cell">{t("group")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("invoiceCount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2">
                      <Link href={`${base}/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {c.countryCode !== "EE" && <span>{countryName(c.countryCode, locale)}</span>}
                        {c.isPerson && <Badge variant="outline">{t("person")}</Badge>}
                        {!c.active && <Badge variant="outline">{t("inactive")}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{c.regCode ?? "—"}</td>
                    <td className="hidden px-3 py-2 md:table-cell">{c.email ?? "—"}</td>
                    <td className="hidden px-3 py-2 lg:table-cell">{c.group?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c._count.invoices}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
      </Card>
    </div>
  );
}
