import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { nextFiscalYear } from "@/lib/accounting/fiscal";
import { PageHeader } from "@/components/common/page-header";
import { FiscalYearsManager, type YearRow } from "./fiscal-years-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.fiscalYears") };
}

export default async function FiscalYearsPage({ params }: PageProps<"/c/[companyId]/settings/fiscal-years">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("fiscal");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "confirm");

  const [years, company] = await Promise.all([
    ctx.cdb.fiscalYear.findMany({ orderBy: { startDate: "desc" } }),
    ctx.cdb.company.findFirstOrThrow({ select: { lockedUntil: true } }),
  ]);
  const counts = await Promise.all(
    years.map((y) =>
      ctx.cdb.journalEntry.count({ where: { date: { gte: y.startDate, lte: y.endDate }, source: { not: "OPENING_BALANCE" } } }),
    ),
  );

  const rows: YearRow[] = years.map((y, i) => ({
    id: y.id,
    startDate: toISODate(y.startDate),
    endDate: toISODate(y.endDate),
    closed: Boolean(y.closedAt),
    entries: counts[i] ?? 0,
  }));
  const next = nextFiscalYear(years);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={tn("items.settings.fiscalYears")} description={t("subtitle")} />
      <FiscalYearsManager
        companyId={companyId}
        years={rows}
        lockedUntil={company.lockedUntil ? toISODate(company.lockedUntil) : ""}
        suggestion={next ? { startDate: toISODate(next.startDate), endDate: toISODate(next.endDate) } : null}
        canEdit={canEdit}
      />
    </div>
  );
}
