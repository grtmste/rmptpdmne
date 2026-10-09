import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cashFlow } from "@/server/reports/financial";
import { PageHeader } from "@/components/common/page-header";
import { ReportFilters } from "../report-filters";
import { loadFilterOptions, parseReportQuery } from "../report-params";
import { StatementTable } from "../statement-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.cashFlow") };
}

export default async function CashFlowPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/cash-flow">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "reports");
  const t = await getTranslations("statements");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseReportQuery(ctx, sp);
  const [report, options] = await Promise.all([cashFlow(db, companyId, { from: q.from, to: q.to }), loadFilterOptions(ctx)]);
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={tn("items.finance.cashFlow")}
        description={`${tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} · ${t("indirectMethod")}`}
      />
      <ReportFilters
        initial={{ from: q.fromIso, to: q.toIso, account: "", department: "", dimension: "", zero: false }}
        options={options}
        hideDimensions
        exportHref={`/c/${companyId}/finance/export/cash-flow?${qs}`}
      />
      <StatementTable rows={report.rows} amountLabel={`${formatDate(q.from, locale)} – ${formatDate(q.to, locale)}`} />
      <p className={report.difference.isZero() ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>
        {report.difference.isZero() ? t("cashFlowNote") : t("cashFlowDifference", { amount: formatMoney(report.difference, locale) })}
      </p>
    </div>
  );
}
