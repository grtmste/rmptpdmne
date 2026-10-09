import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Package } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQuantity } from "@/lib/money";
import { stockTurnover } from "@/server/reports/inventory";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { parseDocReportQuery } from "@/components/reports/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.inventory.turnover") };
}

export default async function StockTurnoverPage({ params, searchParams }: PageProps<"/c/[companyId]/inventory/turnover">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "inventory");
  const t = await getTranslations("inventory");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
  const warehouses = await ctx.cdb.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true, name: true } });
  const warehouse = warehouses.some((w) => w.id === sp.warehouse) ? (sp.warehouse as string) : "";
  const r = await stockTurnover(db, companyId, { from: q.from, to: q.to, warehouseId: warehouse || null });
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso, ...(warehouse ? { warehouse } : {}) });
  const qty = (v: Parameters<typeof formatQuantity>[0]) => formatQuantity(v, locale);
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, locale);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title={tn("items.inventory.turnover")} description={tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} />
      <ReportBar
        fields={[
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: tr("to"), type: "date" },
          { key: "warehouse", label: t("warehouse"), type: "select", options: [{ value: "", label: t("allWarehouses") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))] },
        ]}
        initial={{ from: q.fromIso, to: q.toIso, warehouse }}
        exportHref={`/c/${companyId}/report-export/stock-turnover?${qs}`}
      />
      <Card className="overflow-hidden">
        {r.rows.length === 0 ? (
          <EmptyState icon={Package} title={t("noStockTitle")} description={t("noStockBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="stock-turnover">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium" rowSpan={2}>
                    {t("item")}
                  </th>
                  {(["opening", "in", "out", "closing"] as const).map((k) => (
                    <th key={k} className="border-l px-3 pt-2 text-center font-medium" colSpan={2}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
                <tr>
                  {[0, 1, 2, 3].map((i) => [
                    <th key={`q${i}`} className="border-l px-3 pb-2 text-right font-normal">
                      {t("quantity")}
                    </th>,
                    <th key={`v${i}`} className="px-3 pb-2 text-right font-normal">
                      {t("value")}
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.rows.map((x) => (
                  <tr key={x.itemId} className="hover:bg-muted/40">
                    <td className="px-4 py-1.5">
                      <Link className="hover:underline" href={`/c/${companyId}/inventory/item-movement?item=${x.itemId}&${qs}`}>
                        <span className="font-mono text-xs text-muted-foreground">{x.code}</span> {x.name}
                      </Link>
                    </td>
                    <td className="border-l px-3 py-1.5 text-right tabular-nums">{qty(x.openingQty)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.openingValue)}</td>
                    <td className="border-l px-3 py-1.5 text-right tabular-nums">{qty(x.inQty)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.inValue)}</td>
                    <td className="border-l px-3 py-1.5 text-right tabular-nums">{qty(x.outQty)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.outValue)}</td>
                    <td className="border-l px-3 py-1.5 text-right tabular-nums">{qty(x.closingQty)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{m(x.closingValue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-4 py-2">{t("total")}</td>
                  <td className="border-l" />
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.openingValue)}</td>
                  <td className="border-l" />
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.inValue)}</td>
                  <td className="border-l" />
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.outValue)}</td>
                  <td className="border-l" />
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.closingValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
