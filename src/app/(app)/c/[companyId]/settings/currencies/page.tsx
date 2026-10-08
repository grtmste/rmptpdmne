import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { CurrenciesManager, type CurrencyRow } from "./currencies-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.currencies") };
}

export default async function CurrenciesPage({ params }: PageProps<"/c/[companyId]/settings/currencies">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("currencies");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "edit");

  const selected = await ctx.cdb.companyCurrency.findMany({ orderBy: { code: "asc" } });
  const codes = selected.map((s) => s.code);
  // Viimane kurss iga valitud valuuta kohta (kursid on ettevõtteülesed)
  const latest = codes.length
    ? await db.exchangeRate.findMany({
        where: { currency: { in: codes } },
        orderBy: [{ currency: "asc" }, { date: "desc" }],
        distinct: ["currency"],
      })
    : [];
  const byCode = new Map(latest.map((r) => [r.currency, r]));
  const rows: CurrencyRow[] = codes.map((code) => {
    const r = byCode.get(code);
    return { code, rate: r?.rate.toString() ?? null, date: r ? toISODate(r.date) : null, source: r?.source ?? null };
  });
  const newest = await db.exchangeRate.findFirst({ where: { source: "ECB" }, orderBy: { date: "desc" }, select: { date: true } });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={tn("items.settings.currencies")} description={t("subtitle")} />
      <CurrenciesManager
        companyId={companyId}
        currencies={rows}
        newestEcb={newest ? toISODate(newest.date) : null}
        canEdit={canEdit}
      />
    </div>
  );
}
