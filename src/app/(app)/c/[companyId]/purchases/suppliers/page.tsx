import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus, Truck } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { countryName } from "@/lib/countries";
import { formatIban } from "@/lib/iban";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { SupplierGroups } from "./supplier-groups";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.suppliers") };
}

const PAGE_SIZE = 50;

export default async function SuppliersPage({ params, searchParams }: PageProps<"/c/[companyId]/purchases/suppliers">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("suppliers");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const group = str(sp.group);
  const showInactive = str(sp.inactive) === "1";
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const where: Prisma.SupplierWhereInput = {
    ...(showInactive ? {} : { active: true }),
    ...(group ? { groupId: group } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { regCode: { contains: q } },
            { vatNumber: { contains: q, mode: "insensitive" } },
            { bankAccount: { contains: q.replace(/\s+/g, "").toUpperCase() } },
          ],
        }
      : {}),
  };
  const [total, suppliers, groups] = await Promise.all([
    ctx.cdb.supplier.count({ where }),
    ctx.cdb.supplier.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { group: { select: { name: true } }, _count: { select: { invoices: true } } },
    }),
    ctx.cdb.supplierGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { suppliers: true } } } }),
  ]);
  const canEdit = can(ctx.membership, "purchases", "edit");
  const base = `/c/${companyId}/purchases/suppliers`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={tn("items.purchases.suppliers")}
        description={t("listSubtitle")}
        actions={
          <>
            <SupplierGroups companyId={companyId} canEdit={canEdit} groups={groups.map((g) => ({ id: g.id, name: g.name, count: g._count.suppliers }))} />
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
        filters={[{ name: "group", label: t("group"), options: [{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))] }]}
        toggles={[{ name: "inactive", label: t("showInactive") }]}
      />
      <Card className="mt-4 overflow-hidden">
        {suppliers.length === 0 ? (
          <EmptyState
            icon={Truck}
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
                  <th className="hidden px-3 py-2 text-left font-medium md:table-cell">{t("bankAccount")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium lg:table-cell">{t("group")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("invoiceCount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2">
                      <Link href={`${base}/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {s.countryCode !== "EE" && <span>{countryName(s.countryCode, locale)}</span>}
                        {!s.active && <Badge variant="outline">{t("inactive")}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{s.regCode ?? "—"}</td>
                    <td className="hidden px-3 py-2 font-mono text-xs md:table-cell">{s.bankAccount ? formatIban(s.bankAccount) : "—"}</td>
                    <td className="hidden px-3 py-2 lg:table-cell">{s.group?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s._count.invoices}</td>
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
