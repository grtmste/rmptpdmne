import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type Decimal from "decimal.js";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { generalLedger } from "@/server/reports/ledger";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { ReportFilters } from "../report-filters";
import { loadFilterOptions, parseReportQuery } from "../report-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.ledger") };
}

export default async function LedgerPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/ledger">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "finance");
  const t = await getTranslations("reports");
  const tj = await getTranslations("journal");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseReportQuery(ctx, sp);
  const [report, options] = await Promise.all([generalLedger(db, companyId, q), loadFilterOptions(ctx)]);

  const m = (v: Decimal) => (v.isZero() ? "" : formatMoney(v, locale));
  const bal = (v: Decimal) => (v.isZero() ? formatMoney(0, locale) : `${formatMoney(v.abs(), locale)} ${v.isPositive() ? t("dShort") : t("cShort")}`);
  const exportQs = new URLSearchParams({ from: q.fromIso, to: q.toIso });
  for (const id of q.accountIds ?? []) exportQs.append("account", id);
  if (q.departmentId) exportQs.set("department", q.departmentId);
  if (q.dimensionValueId) exportQs.set("dimension", q.dimensionValueId);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={tn("items.finance.ledger")}
        description={t("periodLabel", { from: formatDate(q.from, locale), to: formatDate(q.to, locale) })}
      />
      <ReportFilters
        initial={{
          from: q.fromIso,
          to: q.toIso,
          account: q.accountIds?.[0] ?? "",
          department: q.departmentId ?? "",
          dimension: q.dimensionValueId ?? "",
          zero: false,
        }}
        options={options}
        exportHref={`/c/${companyId}/finance/export/ledger?${exportQs}`}
        showAccount
      />
      {report.truncated && <p className="text-sm font-medium text-warning">{t("truncated")}</p>}
      {report.accounts.length === 0 && (
        <Card>
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noData")}</p>
        </Card>
      )}
      {report.accounts.map((a) => (
        <Card key={a.accountId} className="overflow-hidden break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">
              <span className="font-mono">{a.code}</span> {a.name}
            </h2>
            <span className="text-sm text-muted-foreground">
              {t("openingBalance")}: <b className="tabular-nums text-foreground">{bal(a.opening)}</b>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="w-28 px-4 py-2 text-left font-medium">{t("date")}</th>
                  <th className="w-28 px-3 py-2 text-left font-medium">{t("entry")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("description")}</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">{t("debit")}</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">{t("credit")}</th>
                  <th className="w-40 px-4 py-2 text-right font-medium">{t("balance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {a.lines.map((l, i) => (
                  <tr key={`${l.entryId}-${i}`} className="hover:bg-muted/30">
                    <td className="px-4 py-1.5 tabular-nums">{formatDate(l.date, locale)}</td>
                    <td className="px-3 py-1.5">
                      <Link href={`/c/${companyId}/finance/journal?entry=${l.entryId}`} className="font-mono text-[13px] text-primary hover:underline">
                        {l.number}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{l.description || tj(`sources.${l.source}`)}</td>
                    <td className="num px-3 py-1.5">{m(l.debit)}</td>
                    <td className="num px-3 py-1.5">{m(l.credit)}</td>
                    <td className="num px-4 py-1.5">{bal(l.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td colSpan={3} className="px-4 py-2">
                    {t("periodTotal")}
                  </td>
                  <td className="num px-3 py-2">{formatMoney(a.debit, locale)}</td>
                  <td className="num px-3 py-2">{formatMoney(a.credit, locale)}</td>
                  <td className="num px-4 py-2">{bal(a.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
