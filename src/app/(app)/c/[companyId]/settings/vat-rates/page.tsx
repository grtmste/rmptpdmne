import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { resolveVatRate } from "@/lib/accounting/vat";
import { todayLocal } from "@/lib/dates";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { VatManager, type VatRow } from "./vat-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.vatRates") };
}

export default async function VatRatesPage({ params }: PageProps<"/c/[companyId]/settings/vat-rates">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("vat");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "edit");

  const [rates, accounts, usage] = await Promise.all([
    ctx.cdb.vatRate.findMany({ orderBy: { sortOrder: "asc" }, include: { periods: { orderBy: { validFrom: "asc" } } } }),
    ctx.cdb.glAccount.findMany({
      where: { kind: "DETAIL", type: { in: ["LIABILITY", "ASSET"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    ctx.cdb.journalLine.groupBy({ by: ["vatRateId"], where: { vatRateId: { not: null } }, _count: { _all: true } }),
  ]);
  const used = new Set(usage.map((u) => u.vatRateId));
  const today = todayLocal();

  const rows: VatRow[] = rates.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    nameEn: r.nameEn ?? "",
    kind: r.kind,
    deductiblePct: r.deductiblePct.toString(),
    invoiceNote: r.invoiceNote ?? "",
    salesAccountId: r.salesAccountId ?? "",
    purchaseAccountId: r.purchaseAccountId ?? "",
    active: r.active,
    used: used.has(r.id),
    currentRate: resolveVatRate(r.periods, today)?.toString() ?? null,
    periods: r.periods.map((p) => ({
      rate: p.rate.toString(),
      validFrom: toISODate(p.validFrom),
      validTo: p.validTo ? toISODate(p.validTo) : "",
    })),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={tn("items.settings.vatRates")} description={t("subtitle")} />
      {rows.length === 0 ? (
        <SetupRequired companyId={companyId} canEdit={canEdit} />
      ) : (
        <VatManager companyId={companyId} rates={rows} accounts={accounts} canEdit={canEdit} />
      )}
    </div>
  );
}
