import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQuantity } from "@/lib/money";
import { cn } from "@/lib/utils";
import { stockAnalysis } from "@/server/reports/inventory";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { parseDocReportQuery } from "@/components/reports/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.inventory.analysis") };
}

export default async function StockAnalysisPage({ params, searchParams }: PageProps<"/c/[companyId]/inventory/analysis">) {
  const { companyId } = await params;
  const sp = await searchParams;
  await requireCompany(companyId, "reports");
  const t = await getTranslations("inventory");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
  const r = await stockAnalysis(db, companyId, { from: q.from, to: q.to });
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso });
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, locale);
  const pct = (v: Parameters<typeof formatMoney>[0] | null) => (v === null ? "—" : `${formatMoney(v, locale, { scale: 1 })} %`);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={tn("items.inventory.analysis")} description={tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} />
      <ReportBar
        fields={[
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: tr("to"), type: "date" },
        ]}
        initial={{ from: q.fromIso, to: q.toIso }}
        exportHref={`/c/${companyId}/report-export/stock-analysis?${qs}`}
      />
      <Card className="overflow-hidden">
        {r.rows.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t("noSalesTitle")} description={t("noSalesBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="stock-analysis">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("item")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("soldQuantity")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("revenue")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("cost")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("margin")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("marginPct")}</th>
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
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatQuantity(x.quantity, locale)} <span className="text-xs text-muted-foreground">{x.unit}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.revenue)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.cost)}</td>
                    <td className={cn("px-3 py-1.5 text-right font-medium tabular-nums", x.margin.isNegative() && "text-destructive")}>{m(x.margin)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{pct(x.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={2}>
                    {t("total")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.margin)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(r.totals.marginPct)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t("analysisNote")}</p>
    </div>
  );
}
