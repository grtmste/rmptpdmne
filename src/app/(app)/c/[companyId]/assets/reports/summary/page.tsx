import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { PackageOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { assetSummary, type SummaryRow } from "@/server/reports/assets";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { parseDocReportQuery } from "@/components/reports/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.assets.summary") };
}

const COST = ["openingCost", "additions", "revaluations", "disposals", "closingCost"] as const;
const ACC = ["openingAccumulated", "depreciation", "accumulatedDisposals", "closingAccumulated"] as const;
const BV = ["openingBookValue", "closingBookValue"] as const;

/** Koondaruanne: read on näitajad, veerud grupid (nagu majandusaasta aruande lisas). */
export default async function AssetSummaryPage({ params, searchParams }: PageProps<"/c/[companyId]/assets/reports/summary">) {
  const { companyId } = await params;
  const sp = await searchParams;
  await requireCompany(companyId, "reports");
  const t = await getTranslations("assets");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
  const r = await assetSummary(db, companyId, { from: q.from, to: q.to });
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso });
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, locale);
  const section = (title: string, keys: readonly (keyof SummaryRow)[], strong: string[]) => (
    <tbody className="divide-y border-b">
      <tr className="bg-muted/30">
        <td className="px-4 py-1.5 font-medium" colSpan={r.rows.length + 2}>
          {title}
        </td>
      </tr>
      {keys.map((k) => (
        <tr key={k} className={strong.includes(k) ? "font-semibold" : undefined}>
          <td className="px-4 py-1.5 pl-8">{t(`summary.${k}`)}</td>
          {r.rows.map((g) => (
            <td key={g.groupId} className="px-3 py-1.5 text-right tabular-nums">
              {m(g[k] as Parameters<typeof formatMoney>[0])}
            </td>
          ))}
          <td className="px-4 py-1.5 text-right font-medium tabular-nums">{m(r.totals[k as keyof typeof r.totals])}</td>
        </tr>
      ))}
    </tbody>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title={tn("items.assets.summary")} description={tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} />
      <ReportBar
        fields={[
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: tr("to"), type: "date" },
        ]}
        initial={{ from: q.fromIso, to: q.toIso }}
        exportHref={`/c/${companyId}/report-export/asset-summary?${qs}`}
      />
      <Card className="overflow-hidden">
        {r.rows.length === 0 ? (
          <EmptyState icon={PackageOpen} title={t("noAssetsTitle")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="asset-summary">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium" />
                  {r.rows.map((g) => (
                    <th key={g.groupId} className="px-3 py-2 text-right font-medium">
                      {g.group}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">{t("total")}</th>
                </tr>
              </thead>
              {section(t("summary.costTitle"), COST, ["openingCost", "closingCost"])}
              {section(t("summary.accumulatedTitle"), ACC, ["openingAccumulated", "closingAccumulated"])}
              {section(t("summary.bookValueTitle"), BV, ["openingBookValue", "closingBookValue"])}
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t("summaryNote")}</p>
    </div>
  );
}
