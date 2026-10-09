import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Layers } from "lucide-react";
import { requireCompany } from "@/server/session";
import { toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ConsolidateForm, type QuoteGroup } from "./consolidate-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.consolidated") };
}

export default async function ConsolidatedPage({ params }: PageProps<"/c/[companyId]/sales/consolidated">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("consolidated");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const quotes = await ctx.cdb.quote.findMany({
    where: { status: { in: ["DRAFT", "SENT", "ACCEPTED"] } },
    orderBy: [{ customerName: "asc" }, { date: "asc" }],
    include: { lines: { select: { description: true }, orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  const groups = new Map<string, QuoteGroup>();
  for (const q of quotes) {
    const g = groups.get(q.customerId) ?? { customerId: q.customerId, customerName: q.customerName, quotes: [] };
    g.quotes.push({
      id: q.id,
      number: q.number,
      date: formatDate(q.date, locale),
      status: q.status,
      currency: q.currency,
      total: q.total.toFixed(2),
      description: q.lines[0]?.description ?? "",
    });
    groups.set(q.customerId, g);
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={tn("items.sales.consolidated")} description={t("subtitle")} />
      {groups.size === 0 ? (
        <EmptyState icon={Layers} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ConsolidateForm companyId={companyId} groups={[...groups.values()]} today={toISODate(todayLocal())} />
      )}
    </div>
  );
}
