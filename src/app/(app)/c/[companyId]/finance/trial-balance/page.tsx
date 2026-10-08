import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type Decimal from "decimal.js";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { trialBalance, type TrialBalanceRow } from "@/server/reports/ledger";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { ReportFilters } from "../report-filters";
import { loadFilterOptions, parseReportQuery } from "../report-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.trialBalance") };
}

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export default async function TrialBalancePage({ params, searchParams }: PageProps<"/c/[companyId]/finance/trial-balance">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "finance");
  const t = await getTranslations("reports");
  const ta = await getTranslations("accounts");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseReportQuery(ctx, sp);
  const [report, options] = await Promise.all([trialBalance(db, companyId, q), loadFilterOptions(ctx)]);

  const m = (v: Decimal) => (v.isZero() ? "" : formatMoney(v, locale));
  const dr = (v: Decimal) => (v.isPositive() ? m(v) : "");
  const cr = (v: Decimal) => (v.isNegative() ? m(v.negated()) : "");
  const exportQs = new URLSearchParams({ from: q.fromIso, to: q.toIso, ...(q.includeZero ? { zero: "1" } : {}) });
  if (q.departmentId) exportQs.set("department", q.departmentId);
  if (q.dimensionValueId) exportQs.set("dimension", q.dimensionValueId);
  const ledgerHref = (accountId: string) =>
    `/c/${companyId}/finance/ledger?from=${q.fromIso}&to=${q.toIso}&account=${accountId}`;

  const subtotal = (rows: TrialBalanceRow[]) => ({
    opening: rows.reduce((s, r) => s.plus(r.opening), dec(0)),
    debit: rows.reduce((s, r) => s.plus(r.debit), dec(0)),
    credit: rows.reduce((s, r) => s.plus(r.credit), dec(0)),
    closing: rows.reduce((s, r) => s.plus(r.closing), dec(0)),
  });
  const totalsBalanced =
    report.totals.debit.equals(report.totals.credit) && report.totals.closingDebit.equals(report.totals.closingCredit);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={tn("items.finance.trialBalance")}
        description={t("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })}
      />
      <ReportFilters
        initial={{ from: q.fromIso, to: q.toIso, account: "", department: q.departmentId ?? "", dimension: q.dimensionValueId ?? "", zero: q.includeZero }}
        options={options}
        exportHref={`/c/${companyId}/finance/export/trial-balance?${exportQs}`}
        showZero
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left font-medium">
                  {t("account")}
                </th>
                <th colSpan={2} className="border-l px-3 pt-2 text-center font-medium">
                  {t("opening")}
                </th>
                <th colSpan={2} className="border-l px-3 pt-2 text-center font-medium">
                  {t("turnover")}
                </th>
                <th colSpan={2} className="border-l px-3 pt-2 text-center font-medium">
                  {t("closing")}
                </th>
              </tr>
              <tr>
                {[0, 1, 2].map((i) => (
                  <FragmentHeaders key={i} debit={t("debit")} credit={t("credit")} />
                ))}
              </tr>
            </thead>
            {TYPES.map((type) => {
              const rows = report.rows.filter((r) => r.type === type);
              if (rows.length === 0) return null;
              const s = subtotal(rows);
              return (
                <tbody key={type} className="divide-y">
                  <tr className="bg-muted/30">
                    <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {ta(`types.${type}`)}
                    </td>
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.accountId} className="hover:bg-muted/30">
                      <td className="px-3 py-1.5">
                        <Link href={ledgerHref(r.accountId)} className="hover:text-primary hover:underline">
                          <span className="font-mono text-[13px]">{r.code}</span> {r.name}
                        </Link>
                      </td>
                      <td className="num border-l px-3 py-1.5">{dr(r.opening)}</td>
                      <td className="num px-3 py-1.5">{cr(r.opening)}</td>
                      <td className="num border-l px-3 py-1.5">{m(r.debit)}</td>
                      <td className="num px-3 py-1.5">{m(r.credit)}</td>
                      <td className="num border-l px-3 py-1.5 font-medium">{dr(r.closing)}</td>
                      <td className="num px-3 py-1.5 font-medium">{cr(r.closing)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/20 text-xs font-semibold">
                    <td className="px-3 py-1.5">{t("subtotal", { type: ta(`types.${type}`) })}</td>
                    <td className="num border-l px-3 py-1.5">{dr(s.opening)}</td>
                    <td className="num px-3 py-1.5">{cr(s.opening)}</td>
                    <td className="num border-l px-3 py-1.5">{m(s.debit)}</td>
                    <td className="num px-3 py-1.5">{m(s.credit)}</td>
                    <td className="num border-l px-3 py-1.5">{dr(s.closing)}</td>
                    <td className="num px-3 py-1.5">{cr(s.closing)}</td>
                  </tr>
                </tbody>
              );
            })}
            <tfoot className="border-t-2 font-semibold">
              <tr>
                <td className="px-3 py-2">{t("total")}</td>
                <td className="num border-l px-3 py-2">{formatMoney(report.totals.openingDebit, locale)}</td>
                <td className="num px-3 py-2">{formatMoney(report.totals.openingCredit, locale)}</td>
                <td className="num border-l px-3 py-2">{formatMoney(report.totals.debit, locale)}</td>
                <td className="num px-3 py-2">{formatMoney(report.totals.credit, locale)}</td>
                <td className="num border-l px-3 py-2">{formatMoney(report.totals.closingDebit, locale)}</td>
                <td className="num px-3 py-2">{formatMoney(report.totals.closingCredit, locale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {report.rows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("noData")}</p>}
      </Card>
      <p className={cn("text-xs", totalsBalanced ? "text-muted-foreground" : "font-medium text-destructive")}>
        {totalsBalanced ? t("balancedNote") : t("unbalancedNote")} {t("pnlNote")}
      </p>
    </div>
  );
}

function FragmentHeaders({ debit, credit }: { debit: string; credit: string }) {
  return (
    <>
      <th className="border-l px-3 pb-2 text-right font-medium">{debit}</th>
      <th className="px-3 pb-2 text-right font-medium">{credit}</th>
    </>
  );
}
