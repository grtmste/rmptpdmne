import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate, todayLocal } from "@/lib/dates";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatMoney } from "@/lib/money";
import { balanceSheet } from "@/server/reports/financial";
import { withoutEmptyLines } from "@/lib/reports/statements";
import { PageHeader } from "@/components/common/page-header";
import { ReportFilters } from "../report-filters";
import { loadFilterOptions } from "../report-params";
import { StatementTable } from "../statement-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.balanceSheet") };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export default async function BalanceSheetPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/balance-sheet">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "reports");
  const t = await getTranslations("statements");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const date = parseISODate(str(sp.to)) ?? todayLocal();
  const compare = str(sp.compare) !== "0";
  const detail = str(sp.detail) === "1";
  const [report, options] = await Promise.all([balanceSheet(db, companyId, { date, compare }), loadFilterOptions(ctx)]);
  const iso = toISODate(date);
  const qs = new URLSearchParams({ to: iso, compare: compare ? "1" : "0" });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={tn("items.finance.balanceSheet")} description={t("asOfLabel", { date: formatDate(date, locale) })} />
      <ReportFilters
        initial={{ from: "", to: iso, account: "", department: "", dimension: "", zero: false, extras: { compare: compare ? "1" : "0", detail: detail ? "1" : "" } }}
        options={options}
        singleDate
        hideDimensions
        extras={[
          { key: "compare", label: t("comparePrevYearEnd") },
          { key: "detail", label: t("showAccounts") },
        ]}
        exportHref={`/c/${companyId}/finance/export/balance-sheet?${qs}`}
      />
      <StatementTable
        rows={detail ? report.rows : withoutEmptyLines(report.rows)}
        amountLabel={formatDate(date, locale)}
        compareLabel={report.compareDate ? formatDate(report.compareDate, locale) : null}
        detail={detail}
        ledgerHref={(id) => `/c/${companyId}/finance/ledger?to=${iso}&account=${id}`}
      />
      {!report.difference.isZero() && (
        <p className="text-xs font-medium text-destructive">{t("balanceDifference", { amount: formatMoney(report.difference, locale) })}</p>
      )}
    </div>
  );
}
