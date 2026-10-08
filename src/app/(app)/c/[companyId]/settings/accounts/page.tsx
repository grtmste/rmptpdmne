import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { AccountsManager, type AccountRow } from "./accounts-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.settings.accounts") };
}

export default async function AccountsPage({ params }: PageProps<"/c/[companyId]/settings/accounts">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "settings");
  const t = await getTranslations("accounts");
  const tn = await getTranslations("nav");
  const canEdit = can(ctx.membership, "settings", "edit");

  const [accounts, vatRates, dimensions, usage] = await Promise.all([
    ctx.cdb.glAccount.findMany({ orderBy: { code: "asc" } }),
    ctx.cdb.vatRate.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, active: true } }),
    ctx.cdb.dimension.findMany({ where: { kind: "DETAIL" }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.journalLine.groupBy({ by: ["accountId"], _count: { _all: true } }),
  ]);
  const used = new Set(usage.map((u) => u.accountId));

  const rows: AccountRow[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    nameEn: a.nameEn ?? "",
    type: a.type,
    kind: a.kind,
    reportLine: a.reportLine ?? "",
    defaultVatRateId: a.defaultVatRateId ?? "",
    vatTurnover: a.vatTurnover,
    isPaymentMethod: a.isPaymentMethod,
    requiresDepartment: a.requiresDepartment,
    requiredDimensionIds: a.requiredDimensionIds,
    showOnDashboard: a.showOnDashboard,
    active: a.active,
    role: a.role,
    used: used.has(a.id),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={tn("items.settings.accounts")} description={t("subtitle")} />
      {rows.length === 0 ? (
        <SetupRequired companyId={companyId} canEdit={canEdit} />
      ) : (
        <AccountsManager companyId={companyId} accounts={rows} vatRates={vatRates} dimensions={dimensions} canEdit={canEdit} />
      )}
    </div>
  );
}
