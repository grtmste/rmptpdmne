import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { dayBook } from "@/server/reports/ledger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { ReportFilters } from "../report-filters";
import { loadFilterOptions, parseReportQuery } from "../report-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.daybook") };
}

export default async function DayBookPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/daybook">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "finance");
  const t = await getTranslations("reports");
  const tj = await getTranslations("journal");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const q = await parseReportQuery(ctx, sp);
  const [book, options] = await Promise.all([dayBook(db, companyId, q, q.page), loadFilterOptions(ctx)]);
  const pages = Math.max(1, Math.ceil(book.total / book.pageSize));

  const qs = new URLSearchParams({ from: q.fromIso, to: q.toIso });
  if (q.departmentId) qs.set("department", q.departmentId);
  if (q.dimensionValueId) qs.set("dimension", q.dimensionValueId);
  for (const id of q.accountIds ?? []) qs.append("account", id);
  const pageHref = (p: number) => {
    const s = new URLSearchParams(qs);
    s.set("page", String(p));
    return `/c/${companyId}/finance/daybook?${s}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={tn("items.finance.daybook")}
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
        exportHref={`/c/${companyId}/finance/export/daybook?${qs}`}
        showAccount
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-28 px-4 py-2 text-left font-medium">{t("date")}</th>
                <th className="w-28 px-3 py-2 text-left font-medium">{t("entry")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("account")}</th>
                <th className="w-32 px-3 py-2 text-right font-medium">{t("debit")}</th>
                <th className="w-32 px-4 py-2 text-right font-medium">{t("credit")}</th>
              </tr>
            </thead>
            {book.entries.map((e) => (
              <tbody key={e.id} className="border-b">
                <tr className="bg-muted/20">
                  <td className="px-4 py-1.5 font-medium tabular-nums">{formatDate(e.date, locale)}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/c/${companyId}/finance/journal?entry=${e.id}`} className="font-mono text-[13px] font-medium text-primary hover:underline">
                      {e.number}
                    </Link>
                  </td>
                  <td colSpan={3} className="px-3 py-1.5 text-muted-foreground">
                    {e.description || tj(`sources.${e.source}`)}
                  </td>
                </tr>
                {e.lines.map((l) => (
                  <tr key={l.id}>
                    <td />
                    <td />
                    <td className="px-3 py-1">
                      <span className="font-mono text-[13px]">{l.account.code}</span> {l.account.name}
                      {l.description && <span className="text-muted-foreground"> · {l.description}</span>}
                    </td>
                    <td className="num px-3 py-1">{dec(l.debit.toString()).isZero() ? "" : formatMoney(l.debit.toString(), locale)}</td>
                    <td className="num px-4 py-1">{dec(l.credit.toString()).isZero() ? "" : formatMoney(l.credit.toString(), locale)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        {book.entries.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("noData")}</p>}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm print:hidden">
            <span className="text-muted-foreground">{tj("pageOf", { page: book.page, pages, total: book.total })}</span>
            <div className="flex gap-1">
              {book.page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(book.page - 1)}>←</Link>
                </Button>
              )}
              {book.page < pages && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(book.page + 1)}>→</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
