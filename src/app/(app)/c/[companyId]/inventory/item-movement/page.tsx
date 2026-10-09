import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQuantity } from "@/lib/money";
import { itemMovement } from "@/server/reports/inventory";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { parseDocReportQuery } from "@/components/reports/params";
import { PackageSearch } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.inventory.itemMovement") };
}

export default async function ItemMovementPage({ params, searchParams }: PageProps<"/c/[companyId]/inventory/item-movement">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "inventory");
  const t = await getTranslations("inventory");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
  const [items, warehouses] = await Promise.all([
    ctx.cdb.item.findMany({ where: { trackStock: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, unit: true } }),
    ctx.cdb.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true, name: true } }),
  ]);
  const itemId = items.some((i) => i.id === sp.item) ? (sp.item as string) : (items[0]?.id ?? "");
  const warehouse = warehouses.some((w) => w.id === sp.warehouse) ? (sp.warehouse as string) : "";
  const item = items.find((i) => i.id === itemId);
  const report = item ? await itemMovement(db, companyId, { itemId, from: q.from, to: q.to, warehouseId: warehouse || null }) : null;
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const docHref = (r: { movementId: string; salesInvoiceId: string | null; purchaseInvoiceId: string | null }) =>
    r.salesInvoiceId
      ? `/c/${companyId}/sales/invoices?doc=${r.salesInvoiceId}`
      : r.purchaseInvoiceId
        ? `/c/${companyId}/purchases/invoices?doc=${r.purchaseInvoiceId}`
        : `/c/${companyId}/inventory/movements?doc=${r.movementId}`;
  const qty = (v: Parameters<typeof formatQuantity>[0]) => formatQuantity(v, locale);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={tn("items.inventory.itemMovement")} description={tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} />
      <ReportBar
        fields={[
          { key: "item", label: t("item"), type: "select", options: items.map((i) => ({ value: i.id, label: `${i.code} ${i.name}` })) },
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: tr("to"), type: "date" },
          { key: "warehouse", label: t("warehouse"), type: "select", options: [{ value: "", label: t("allWarehouses") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))] },
        ]}
        initial={{ item: itemId, from: q.fromIso, to: q.toIso, warehouse }}
      />
      <Card className="overflow-hidden">
        {!item || !report ? (
          <EmptyState icon={PackageSearch} title={t("noStockItemsTitle")} description={t("noStockItemsBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="item-movement">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("date")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("document")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("in")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("out")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("value")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("balanceQty")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("balanceValue")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="bg-muted/30 font-medium">
                  <td className="px-4 py-1.5" colSpan={5}>
                    {t("opening")}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{qty(report.opening.quantity)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(report.opening.value, locale)}</td>
                </tr>
                {report.rows.map((r) => (
                  <tr key={`${r.id}-${r.warehouseId}`} className="hover:bg-muted/40">
                    <td className="px-4 py-1.5 tabular-nums">{formatDate(r.date, locale)}</td>
                    <td className="px-3 py-1.5">
                      <Link href={docHref(r)} className="font-mono text-[13px] text-primary hover:underline">
                        {r.number ?? "—"}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">
                        {t(`types.${r.type}`)}
                        {r.type === "TRANSFER" ? ` ${whName.get(r.warehouseId)} → ${whName.get(r.toWarehouseId ?? "")}` : !warehouse && warehouses.length > 1 ? ` · ${whName.get(r.warehouseId)}` : ""}
                        {r.description ? ` · ${r.description}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity.isPositive() ? qty(r.quantity) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.quantity.isNegative() ? qty(r.quantity.negated()) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.value, locale)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{qty(r.balanceQty)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(r.balanceValue, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={5}>
                    {t("closing")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {qty(report.closing.quantity)} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(report.closing.value, locale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
