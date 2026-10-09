import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BookOpen, Calculator } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { monthEnd, monthStart } from "@/lib/assets/depreciation";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ensureDefaultAssetGroups, previewDepreciation } from "@/server/services/assets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { CancelRunButton, PeriodPicker, RunButton } from "./run-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.assets.depreciation") };
}

export default async function DepreciationPage({ params, searchParams }: PageProps<"/c/[companyId]/assets/depreciation">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "assets");
  const t = await getTranslations("assets");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  await db.$transaction((tx) => ensureDefaultAssetGroups(tx, companyId, ctx.user.id));
  const runs = await ctx.cdb.depreciationRun.findMany({ orderBy: { period: "desc" }, take: 36, include: { _count: { select: { lines: true } } } });
  const latest = runs[0];
  // Vaikimisi järgmine arvestamata kuu (kuni jooksva kuuni)
  const fromParam = typeof sp.period === "string" && /^\d{4}-\d{2}$/.test(sp.period) ? parseISODate(`${sp.period}-01`) : null;
  const current = monthStart(todayLocal());
  const nextAfterLatest = latest ? monthStart(new Date(Date.UTC(latest.period.getUTCFullYear(), latest.period.getUTCMonth() + 1, 1))) : current;
  const defaultPeriod = nextAfterLatest > current ? current : nextAfterLatest;
  const period = fromParam ?? defaultPeriod;
  const periodIso = toISODate(period).slice(0, 7);
  const done = runs.find((r) => toISODate(r.period) === toISODate(period));
  const rows = done ? [] : await previewDepreciation(db, companyId, period);
  const total = rows.reduce((s, r) => s + Number(r.amount.toFixed(2)) * 100, 0) / 100;
  const highlight = typeof sp.run === "string" ? sp.run : "";
  const canConfirm = can(ctx.membership, "assets", "confirm");
  const later = latest && latest.period > period;
  const future = period > current;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={tn("items.assets.depreciation")} description={t("depreciationSubtitle")} />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-5">
          <PeriodPicker period={periodIso} />
          <div className="text-sm text-muted-foreground">
            {t("entryDate", { date: formatDate(monthEnd(period), locale) })}
          </div>
          {canConfirm && !done && !future && rows.length > 0 && (
            <div className="ml-auto">
              <RunButton companyId={companyId} period={periodIso} disabled={Boolean(later)} />
            </div>
          )}
        </CardContent>
        {later && !done && <p className="px-6 pb-4 text-sm text-warning">{t("laterRunHint")}</p>}
        {future && !done && <p className="px-6 pb-4 text-sm text-muted-foreground">{t("futureHint")}</p>}
        {done ? (
          <p className="px-6 pb-5 text-sm">
            {t("alreadyRun", { total: formatMoney(done.total, locale) })}{" "}
            <Link className="text-primary hover:underline" href={`?period=${periodIso}&run=${done.id}#runs`}>
              {t("showRun")}
            </Link>
          </p>
        ) : rows.length === 0 ? (
          <EmptyState icon={Calculator} title={t("nothingTitle")} description={t("nothingBody")} />
        ) : (
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm" data-testid="depreciation-preview">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-2 text-left font-medium">{t("asset")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("months")}</th>
                  <th className="px-6 py-2 text-right font-medium">{t("depreciation")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.assetId}>
                    <td className="px-6 py-1.5">
                      <Link className="hover:underline" href={`/c/${companyId}/assets?doc=${r.assetId}`}>
                        <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.months}</td>
                    <td className="px-6 py-1.5 text-right tabular-nums">{formatMoney(r.amount, locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-6 py-2" colSpan={2}>
                    {t("total")}
                  </td>
                  <td className="px-6 py-2 text-right tabular-nums">{formatMoney(total.toFixed(2), locale)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {runs.length > 0 && (
        <Card id="runs">
          <CardHeader>
            <CardTitle>{t("runs")}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm" data-testid="depreciation-runs">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">{t("month")}</th>
                  <th className="py-1 text-right font-medium">{t("assetCountShort")}</th>
                  <th className="py-1 text-right font-medium">{t("depreciation")}</th>
                  <th className="w-48" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r, i) => (
                  <tr key={r.id} className={cn(r.id === highlight && "bg-accent/60")}>
                    <td className="py-1.5 tabular-nums">
                      {toISODate(r.period).slice(5, 7)}.{r.period.getUTCFullYear()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r._count.lines}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(r.total, locale)}</td>
                    <td className="py-1 text-right">
                      {r.journalEntryId && can(ctx.membership, "finance", "view") && (
                        <Link className="mr-2 inline-flex items-center gap-1 text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${r.journalEntryId}`}>
                          <BookOpen className="size-3.5" /> {t("entry")}
                        </Link>
                      )}
                      {i === 0 && canConfirm && <CancelRunButton companyId={companyId} id={r.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
