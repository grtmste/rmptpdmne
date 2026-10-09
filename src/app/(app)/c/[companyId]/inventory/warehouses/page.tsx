import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Warehouse } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { stockBalance } from "@/server/reports/inventory";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { WarehouseDialog } from "./warehouse-dialog";
import { CostSettings } from "./cost-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.inventory.warehouses") };
}

export default async function WarehousesPage({ params }: PageProps<"/c/[companyId]/inventory/warehouses">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "inventory");
  const t = await getTranslations("inventory");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const [warehouses, company] = await Promise.all([
    ctx.cdb.warehouse.findMany({ orderBy: [{ active: "desc" }, { isDefault: "desc" }, { code: "asc" }] }),
    ctx.cdb.company.findUniqueOrThrow({ where: { id: companyId }, select: { costMethod: true } }),
  ]);
  const values = await Promise.all(warehouses.map((w) => stockBalance(db, companyId, { date: todayLocal(), warehouseId: w.id })));
  const canEdit = can(ctx.membership, "inventory", "edit");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={tn("items.inventory.warehouses")} description={t("warehousesSubtitle")} actions={canEdit && <WarehouseDialog companyId={companyId} />} />
      {warehouses.length === 0 ? (
        <Card>
          <EmptyState icon={Warehouse} title={t("noWarehousesTitle")} description={t("noWarehousesBody")} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {warehouses.map((w, i) => (
            <Card key={w.id} className={w.active ? undefined : "opacity-60"}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Warehouse className="size-5" />
                    </div>
                    <div>
                      <div className="font-semibold">{w.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{w.code}</div>
                    </div>
                  </div>
                  {canEdit && (
                    <WarehouseDialog companyId={companyId} warehouseId={w.id} initial={{ code: w.code, name: w.name, address: w.address ?? "", isDefault: w.isDefault, active: w.active }} />
                  )}
                </div>
                {w.address && <p className="text-sm text-muted-foreground">{w.address}</p>}
                <div className="flex items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-2 text-sm">
                    {w.isDefault && <Badge variant="secondary">{t("isDefault")}</Badge>}
                    {!w.active && <Badge variant="outline">{t("inactive")}</Badge>}
                    <Link className="text-primary hover:underline" href={`/c/${companyId}/inventory/stock?warehouse=${w.id}`}>
                      {t("viewStock")}
                    </Link>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{t("stockValue")}</div>
                    <div className="text-xl font-semibold tabular-nums">{formatMoney(values[i]!.total, locale, { currency: ctx.company.baseCurrency })}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("costingTitle")}</CardTitle>
          <CardDescription>{t("costingBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CostSettings companyId={companyId} method={company.costMethod} canConfirm={can(ctx.membership, "inventory", "confirm")} />
        </CardContent>
      </Card>
    </div>
  );
}
