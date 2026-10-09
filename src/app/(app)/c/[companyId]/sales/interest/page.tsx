import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Percent } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { interestCandidates } from "@/server/services/interest";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";
import { InterestBuilder } from "./interest-builder";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.reportInterest") };
}

export default async function InterestPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/interest">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("interest");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const asOf = parseISODate(typeof sp.to === "string" ? sp.to : "") ?? todayLocal();
  const candidates = await interestCandidates(db, companyId, asOf);
  const fmt = (d: Date) => formatDate(d, locale);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={tn("items.sales.reportInterest")} description={t("subtitle", { date: fmt(asOf) })} />
      <ReportBar fields={[{ key: "to", label: t("asOf"), type: "date" }]} initial={{ to: toISODate(asOf) }} />
      {candidates.length === 0 ? (
        <EmptyState icon={Percent} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : can(ctx.membership, "sales", "edit") ? (
        <InterestBuilder
          companyId={companyId}
          asOf={toISODate(asOf)}
          canConfirm={can(ctx.membership, "sales", "confirm")}
          customers={candidates.map((c) => ({
            customerId: c.customerId,
            customerName: c.customerName,
            total: c.total.toFixed(2),
            rows: c.rows.map((r) => ({
              invoiceId: r.invoiceId,
              number: r.number,
              dueDate: fmt(r.dueDate),
              from: fmt(r.from),
              to: fmt(r.to),
              days: r.days,
              ratePct: r.ratePct.toDecimalPlaces(3).toString(),
              open: r.open.toFixed(2),
              amount: r.amount.toFixed(2),
              currency: r.currency,
            })),
          }))}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
