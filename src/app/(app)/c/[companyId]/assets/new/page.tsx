import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { dec } from "@/lib/money";
import { toBase } from "@/lib/sales/calc";
import { PageHeader } from "@/components/common/page-header";
import { AssetForm, type AssetValues } from "../asset-form";
import { loadAssetFormData } from "../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets");
  return { title: t("newTitle") };
}

/** Uus põhivara; ?purchaseInvoice= täidab andmed ostuarvelt (põhivara kontodel olevad read). */
export default async function NewAssetPage({ params, searchParams }: PageProps<"/c/[companyId]/assets/new">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "assets", "edit");
  const t = await getTranslations("assets");
  const data = await loadAssetFormData(ctx);
  const count = await ctx.cdb.fixedAsset.count();
  const today = toISODate(todayLocal());
  const g = data.groups.find((x) => x.name === "Masinad ja seadmed") ?? data.groups[0];
  const values: AssetValues = {
    code: `PV-${count + 1}`,
    name: "",
    groupId: g?.id ?? "",
    locationId: "",
    responsibleId: "",
    serialNumber: "",
    acquisitionDate: today,
    depreciationStart: `${today.slice(0, 8)}01`,
    cost: "",
    residualValue: "0",
    usefulLifeMonths: g?.usefulLifeMonths ? String(g.usefulLifeMonths) : "",
    openingDepreciation: "0",
    openingMonths: "0",
    assetAccountId: g?.assetAccountId ?? "",
    accumulatedAccountId: g?.accumulatedAccountId ?? "",
    expenseAccountId: g?.expenseAccountId ?? "",
    departmentId: "",
    purchaseInvoiceId: "",
    notes: "",
  };
  let invoiceLabel: string | null = null;
  if (typeof sp.purchaseInvoice === "string") {
    const inv = await ctx.cdb.purchaseInvoice.findFirst({ where: { id: sp.purchaseInvoice, status: "CONFIRMED" }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    if (inv) {
      const assetAccounts = new Set(data.groups.map((x) => x.assetAccountId));
      const lines = inv.lines.some((l) => assetAccounts.has(l.accountId)) ? inv.lines.filter((l) => assetAccounts.has(l.accountId)) : inv.lines;
      // Soetusmaksumus: ridade summa ilma mahaarvatava käibemaksuta eurodes
      const cost = lines.reduce((s, l) => s.plus(dec(l.netAmount).plus(dec(l.vatAmount)).minus(dec(l.deductibleVat))), dec(0));
      const group = data.groups.find((x) => x.assetAccountId === lines[0]?.accountId) ?? g;
      Object.assign(values, {
        name: lines[0]?.description ?? "",
        acquisitionDate: toISODate(inv.date),
        depreciationStart: `${toISODate(inv.date).slice(0, 8)}01`,
        cost: toBase(cost, inv.currencyRate.toString()).toFixed(2),
        groupId: group?.id ?? "",
        assetAccountId: group?.assetAccountId ?? "",
        accumulatedAccountId: group?.accumulatedAccountId ?? "",
        expenseAccountId: group?.expenseAccountId ?? "",
        usefulLifeMonths: group?.usefulLifeMonths ? String(group.usefulLifeMonths) : "",
        purchaseInvoiceId: inv.id,
      });
      invoiceLabel = `${inv.number ?? ""} ${inv.supplierName} ${inv.invoiceNumber ?? ""}`.trim();
    }
  }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <AssetForm companyId={companyId} initial={values} data={data} purchaseInvoiceLabel={invoiceLabel} />
    </div>
  );
}
