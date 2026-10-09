import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Package } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { ItemDialog, ItemGroups, type ItemValues } from "./item-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.items") };
}

const PAGE_SIZE = 50;

export default async function ItemsPage({ params, searchParams }: PageProps<"/c/[companyId]/items">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("items");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const group = str(sp.group);
  const type = str(sp.type) === "GOODS" || str(sp.type) === "SERVICE" ? (str(sp.type) as "GOODS" | "SERVICE") : null;
  const showInactive = str(sp.inactive) === "1";
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const where: Prisma.ItemWhereInput = {
    ...(showInactive ? {} : { active: true }),
    ...(group ? { groupId: group } : {}),
    ...(type ? { type } : {}),
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, items, groups, vatRates, accounts] = await Promise.all([
    ctx.cdb.item.count({ where }),
    ctx.cdb.item.findMany({ where, orderBy: { code: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { group: { select: { name: true } } } }),
    ctx.cdb.itemGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } }),
    ctx.cdb.vatRate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.glAccount.findMany({
      where: { active: true, kind: "DETAIL", type: { in: ["INCOME", "EXPENSE", "ASSET", "LIABILITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
  ]);
  const canEdit = can(ctx.membership, "sales", "edit");
  const vatName = new Map(vatRates.map((v) => [v.id, v.name]));
  const options = {
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    vatRates,
    salesAccounts: accounts.filter((a) => a.type === "INCOME" || a.type === "LIABILITY").map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })),
    purchaseAccounts: accounts.filter((a) => a.type === "EXPENSE" || a.type === "ASSET").map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })),
    inventoryAccounts: accounts.filter((a) => a.type === "ASSET").map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })),
    cogsAccounts: accounts.filter((a) => a.type === "EXPENSE").map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })),
  };
  const s = (x: { toString(): string } | null) => x?.toString() ?? "";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={tn("items.sales.items")}
        description={t("listSubtitle")}
        actions={
          <>
            <ItemGroups companyId={companyId} canEdit={canEdit} groups={groups.map((g) => ({ id: g.id, name: g.name, count: g._count.items }))} />
            {canEdit && <ItemDialog companyId={companyId} options={options} />}
          </>
        }
      />
      <ListSearch
        placeholder={t("search")}
        filters={[
          {
            name: "type",
            label: t("type"),
            options: [
              { value: "", label: t("allTypes") },
              { value: "SERVICE", label: t("types.SERVICE") },
              { value: "GOODS", label: t("types.GOODS") },
            ],
          },
          { name: "group", label: t("group"), options: [{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))] },
        ]}
        toggles={[{ name: "inactive", label: t("showInactive") }]}
      />
      <Card className="mt-4 overflow-hidden">
        {items.length === 0 ? (
          <EmptyState
            icon={Package}
            title={q || group || type ? t("noResults") : t("emptyTitle")}
            description={q || group || type ? undefined : t("emptyBody")}
            action={canEdit && !q && <ItemDialog companyId={companyId} options={options} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("code")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium md:table-cell">{t("unit")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium md:table-cell">{t("vat")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("salePrice")}</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((i) => {
                  const values: ItemValues = {
                    code: i.code,
                    name: i.name,
                    nameEn: s(i.nameEn),
                    type: i.type,
                    unit: s(i.unit),
                    salePrice: s(i.salePrice),
                    purchasePrice: s(i.purchasePrice),
                    vatRateId: s(i.vatRateId),
                    salesAccountId: s(i.salesAccountId),
                    purchaseAccountId: s(i.purchaseAccountId),
                    groupId: s(i.groupId),
                    forSales: i.forSales,
                    forPurchases: i.forPurchases,
                    trackStock: i.trackStock,
                    inventoryAccountId: s(i.inventoryAccountId),
                    cogsAccountId: s(i.cogsAccountId),
                    description: s(i.description),
                    active: i.active,
                  };
                  return (
                    <tr key={i.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-[13px]">{i.code}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{i.name}</span>
                        <div className="flex gap-1.5 text-xs text-muted-foreground">
                          <span>{t(`types.${i.type}`)}</span>
                          {i.trackStock && <span>· {t("stockItem")}</span>}
                          {i.group && <span>· {i.group.name}</span>}
                          {!i.active && <Badge variant="outline">{t("inactive")}</Badge>}
                        </div>
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">{i.unit ?? "—"}</td>
                      <td className="hidden px-3 py-2 md:table-cell">{i.vatRateId ? vatName.get(i.vatRateId) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {i.salePrice ? formatMoney(i.salePrice, locale, { scale: Math.max(2, Math.min(4, i.salePrice.decimalPlaces())) }) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <ItemDialog companyId={companyId} options={options} itemId={i.id} initial={values} readOnly={!canEdit} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
      </Card>
    </div>
  );
}
