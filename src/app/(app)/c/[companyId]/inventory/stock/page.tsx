import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, Package } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatMoney, formatQuantity } from "@/lib/money";
import { cn } from "@/lib/utils";
import { stockBalance, stockCheck } from "@/server/reports/inventory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.inventory.stock") };
}

export default async function StockPage({ params, searchParams }: PageProps<"/c/[companyId]/inventory/stock">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "inventory");
  const t = await getTranslations("inventory");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const date = parseISODate(str(sp.to)) ?? todayLocal();
  const warehouses = await ctx.cdb.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true, name: true, active: true } });
  const warehouse = warehouses.some((w) => w.id === str(sp.warehouse)) ? str(sp.warehouse) : "";
  const zero = str(sp.zero) === "1";
  const [balance, check] = await Promise.all([
    stockBalance(db, companyId, { date, warehouseId: warehouse || null, includeZero: zero }),
    can(ctx.membership, "reports", "view") && !warehouse ? stockCheck(db, companyId, date) : Promise.resolve(null),
  ]);
  const perWarehouse = !warehouse && warehouses.length > 1;
  const shownWarehouses = warehouses.filter((w) => w.active || balance.rows.some((r) => r.byWarehouse[w.id]));
  const qs = new URLSearchParams({ to: toISODate(date), ...(warehouse ? { warehouse } : {}), ...(zero ? { zero: "1" } : {}) });
  const itemHref = (itemId: string) => `/c/${companyId}/inventory/item-movement?item=${itemId}&to=${toISODate(date)}${warehouse ? `&warehouse=${warehouse}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={tn("items.inventory.stock")}
        description={`${t("asOfLabel", { date: formatDate(date, locale) })}${warehouse ? ` · ${warehouses.find((w) => w.id === warehouse)?.name}` : ""}`}
      />
      <ReportBar
        fields={[
          { key: "to", label: tr("asOf"), type: "date" },
          { key: "warehouse", label: t("warehouse"), type: "select", options: [{ value: "", label: t("allWarehouses") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))] },
          { key: "zero", label: t("showZero"), type: "check" },
        ]}
        initial={{ to: toISODate(date), warehouse, zero: zero ? "1" : "" }}
        exportHref={`/c/${companyId}/report-export/stock?${qs}`}
      />
      <Card className="overflow-hidden">
        {balance.rows.length === 0 ? (
          <EmptyState icon={Package} title={t("noStockTitle")} description={t("noStockBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="stock-table">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("item")}</th>
                  {perWarehouse && shownWarehouses.map((w) => <th key={w.id} className="px-3 py-2 text-right font-medium">{w.name}</th>)}
                  <th className="px-3 py-2 text-right font-medium">{t("quantity")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("unitCost")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("value")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {balance.rows.map((r) => (
                  <tr key={r.itemId} className="hover:bg-muted/40">
                    <td className="px-4 py-1.5">
                      <Link href={itemHref(r.itemId)} className="hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
                      </Link>
                    </td>
                    {perWarehouse &&
                      shownWarehouses.map((w) => (
                        <td key={w.id} className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                          {r.byWarehouse[w.id] ? formatQuantity(r.byWarehouse[w.id]!, locale) : "—"}
                        </td>
                      ))}
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", r.quantity.isNegative() && "text-destructive")}>
                      {formatQuantity(r.quantity, locale)} <span className="text-xs text-muted-foreground">{r.unit}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.unitCost, locale, { scale: 4 })}</td>
                    <td className="px-4 py-1.5 text-right font-medium tabular-nums">{formatMoney(r.value, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={(perWarehouse ? shownWarehouses.length : 0) + 3}>
                    {t("totalValue")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(balance.total, locale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      {warehouse && <p className="text-xs text-muted-foreground">{t("warehouseValueNote")}</p>}
      {check && check.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("checkTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm" data-testid="stock-check">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">{t("account")}</th>
                  <th className="py-1 text-right font-medium">{t("stockValue")}</th>
                  <th className="py-1 text-right font-medium">{t("ledgerBalance")}</th>
                  <th className="py-1 text-right font-medium">{t("difference")}</th>
                </tr>
              </thead>
              <tbody>
                {check.map((c) => (
                  <tr key={c.accountId}>
                    <td className="py-1">
                      {c.code} {c.name}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatMoney(c.stock, locale)}</td>
                    <td className="py-1 text-right tabular-nums">{formatMoney(c.ledger, locale)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {c.difference.isZero() ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-4" /> {t("matches")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-warning">
                          <AlertTriangle className="size-4" /> {formatMoney(c.difference, locale)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {check.some((c) => !c.difference.isZero()) && <p className="mt-3 text-xs text-muted-foreground">{t("checkHint")}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
