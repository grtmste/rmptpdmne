import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { salesReport } from "@/server/reports/documents";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { DocumentReportTable } from "@/components/reports/document-report";
import { parseDocReportQuery } from "@/components/reports/params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.reportSales") };
}

const GROUPS = ["invoice", "customer", "item", "month"] as const;

export default async function SalesReportPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/reports/sales">) {
  const { companyId } = await params;
  await requireCompany(companyId, "reports");
  const t = await getTranslations("docReports");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseDocReportQuery(companyId, await searchParams, GROUPS, "customer");
  const report = await salesReport(db, companyId, { from: q.from, to: q.to, group: q.group, search: q.search });
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso, group: q.group, ...(q.search ? { q: q.search } : {}) });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={tn("items.sales.reportSales")}
        description={`${tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} · ${t("documentCount", { count: report.documentCount })}`}
      />
      <ReportBar
        fields={[
          { key: "from", label: tr("from"), type: "date" },
          { key: "to", label: tr("to"), type: "date" },
          { key: "group", label: t("groupBy"), type: "select", options: GROUPS.map((g) => ({ value: g, label: t(`salesGroups.${g}`) })) },
          { key: "q", label: t("searchSales"), type: "search" },
        ]}
        initial={{ from: q.fromIso, to: q.toIso, group: q.group, q: q.search }}
        exportHref={`/c/${companyId}/report-export/sales?${qs}`}
      />
      <DocumentReportTable
        rows={report.rows}
        totals={report.totals}
        showQuantity={q.group === "item"}
        groupLabel={t(`salesGroups.${q.group}`)}
        docHref={(id) => `/c/${companyId}/sales/invoices?doc=${id}`}
      />
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
