import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { incomeStatement } from "@/server/reports/financial";
import { withoutEmptyLines } from "@/lib/reports/statements";
import { PageHeader } from "@/components/common/page-header";
import { ReportFilters } from "../report-filters";
import { loadFilterOptions, parseReportQuery } from "../report-params";
import { StatementTable } from "../statement-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.incomeStatement") };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export default async function IncomeStatementPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/income-statement">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "reports");
  const t = await getTranslations("statements");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseReportQuery(ctx, sp);
  const scheme = str(sp.scheme) === "2" ? 2 : 1;
  const compare = str(sp.compare) !== "0";
  const detail = str(sp.detail) === "1";
  const [report, options] = await Promise.all([
    incomeStatement(db, companyId, { from: q.from, to: q.to, scheme, compare, departmentId: q.departmentId, dimensionValueId: q.dimensionValueId }),
    loadFilterOptions(ctx),
  ]);
  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso, scheme: String(scheme), compare: compare ? "1" : "0" });
  if (q.departmentId) qs.set("department", q.departmentId);
  if (q.dimensionValueId) qs.set("dimension", q.dimensionValueId);
  const period = (from: Date, to: Date) => `${formatDate(from, locale)} – ${formatDate(to, locale)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={tn("items.finance.incomeStatement")}
        description={`${tr("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })} · ${t(scheme === 1 ? "scheme1" : "scheme2")}`}
      />
      <ReportFilters
        initial={{
          from: q.fromIso,
          to: q.toIso,
          account: "",
          department: q.departmentId ?? "",
          dimension: q.dimensionValueId ?? "",
          zero: false,
          extras: { scheme: String(scheme), compare: compare ? "1" : "0", detail: detail ? "1" : "" },
        }}
        options={options}
        extras={[
          {
            key: "scheme",
            label: t("scheme"),
            options: [
              { value: "1", label: t("scheme1") },
              { value: "2", label: t("scheme2") },
            ],
          },
          { key: "compare", label: t("comparePrevYear") },
          { key: "detail", label: t("showAccounts") },
        ]}
        exportHref={`/c/${companyId}/finance/export/income-statement?${qs}`}
      />
      <StatementTable
        rows={detail ? report.rows : withoutEmptyLines(report.rows)}
        amountLabel={period(q.from, q.to)}
        compareLabel={report.compare ? period(report.compare.from, report.compare.to) : null}
        detail={detail}
        ledgerHref={(id) => `/c/${companyId}/finance/ledger?from=${q.fromIso}&to=${q.toIso}&account=${id}`}
      />
      {scheme === 2 && <p className="text-xs text-muted-foreground">{t("scheme2Note")}</p>}
    </div>
  );
}
