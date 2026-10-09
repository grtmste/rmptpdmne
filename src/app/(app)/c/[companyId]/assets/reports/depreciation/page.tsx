import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Calculator } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { depreciationReport } from "@/server/reports/assets";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { parseDocReportQuery } from "@/components/reports/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.assets.depreciationReport") };
}

export default async function DepreciationReportPage({ params, searchParams }: PageProps<"/c/[companyId]/assets/reports/depreciation">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "reports");
  const t = await getTranslations("assets");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
  const groups = await ctx.cdb.fixedAssetGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const group = groups.some((g) => g.id === sp.group) ? (sp.group as string) : "";
  const r = await depreciationReport(db, companyId, { from: q.from, to: q.to, groupId: group || null });
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso, ...(group ? { group } : {}) });
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, locale);
  const byGroup = new Map<string, typeof r.rows>();
  for (const x of r.rows) byGroup.set(x.group, [...(byGroup.get(x.group) ?? []), x]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={tn("items.assets.depreciationReport")} description={tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} />
      <ReportBar
        fields={[
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: tr("to"), type: "date" },
          { key: "group", label: t("group"), type: "select", options: [{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))] },
        ]}
        initial={{ from: q.fromIso, to: q.toIso, group }}
        exportHref={`/c/${companyId}/report-export/asset-depreciation?${qs}`}
      />
      <Card className="overflow-hidden">
        {r.rows.length === 0 ? (
          <EmptyState icon={Calculator} title={t("noDepreciationTitle")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="depreciation-report">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("asset")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("cost")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("periodDepreciation")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("accumulated")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("bookValue")}</th>
                </tr>
              </thead>
              {[...byGroup].map(([name, rows]) => (
                <tbody key={name} className="divide-y border-b">
                  <tr className="bg-muted/30">
                    <td className="px-4 py-1.5 font-medium" colSpan={2}>
                      {name}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{m(rows.reduce((s, x) => s.plus(x.amount), rows[0]!.amount.minus(rows[0]!.amount)))}</td>
                    <td colSpan={2} />
                  </tr>
                  {rows.map((x) => (
                    <tr key={x.id} className="hover:bg-muted/40">
                      <td className="px-4 py-1.5 pl-8">
                        <Link className="hover:underline" href={`/c/${companyId}/assets?doc=${x.id}`}>
                          <span className="font-mono text-xs text-muted-foreground">{x.code}</span> {x.name}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m(x.cost)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m(x.amount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m(x.accumulated)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{m(x.bookValue)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot className="font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={2}>
                    {t("total")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
