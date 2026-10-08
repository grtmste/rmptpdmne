import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { NumberSeriesManager, type SeriesRow } from "./number-series-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.numberSeries") };
}

const ORDER = [
  "SALES_INVOICE",
  "CREDIT_INVOICE",
  "PREPAYMENT_INVOICE",
  "INTEREST_INVOICE",
  "QUOTE",
  "PURCHASE_ORDER",
  "PAYMENT",
  "JOURNAL_ENTRY",
] as const;

export default async function NumberSeriesPage({ params }: PageProps<"/c/[companyId]/settings/number-series">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("series");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "edit");
  const year = new Date().getUTCFullYear();

  const series = await ctx.cdb.numberSeries.findMany({ include: { counters: { where: { year } } } });
  const rows: SeriesRow[] = series
    .map((s) => ({
      id: s.id,
      documentType: s.documentType,
      prefix: s.prefix,
      suffix: s.suffix,
      yearBased: s.yearBased,
      padding: s.padding,
      nextNumber: s.yearBased ? (s.counters[0]?.nextNumber ?? 1) : s.nextNumber,
    }))
    .sort((a, b) => ORDER.indexOf(a.documentType) - ORDER.indexOf(b.documentType));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={tn("items.settings.numberSeries")} description={t("subtitle")} />
      {rows.length === 0 ? (
        <SetupRequired companyId={companyId} canEdit={canEdit} />
      ) : (
        <NumberSeriesManager companyId={companyId} series={rows} year={year} canEdit={canEdit} />
      )}
    </div>
  );
}
