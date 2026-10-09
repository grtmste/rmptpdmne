import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { AssetForm } from "../../asset-form";
import { loadAssetFormData } from "../../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets");
  return { title: t("editTitle") };
}

export default async function EditAssetPage({ params }: PageProps<"/c/[companyId]/assets/[assetId]/edit">) {
  const { companyId, assetId } = await params;
  const ctx = await requireCompany(companyId, "assets", "edit");
  const t = await getTranslations("assets");
  const a = await ctx.cdb.fixedAsset.findFirst({ where: { id: assetId }, include: { _count: { select: { depreciationLines: true, events: true } } } });
  if (!a) notFound();
  const data = await loadAssetFormData(ctx);
  const inv = a.purchaseInvoiceId ? await ctx.cdb.purchaseInvoice.findFirst({ where: { id: a.purchaseInvoiceId }, select: { number: true, supplierName: true, invoiceNumber: true } }) : null;
  const s = (v: { toString(): string } | null) => v?.toString() ?? "";
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("editTitle")} description={`${a.code} ${a.name}`} />
      <AssetForm
        companyId={companyId}
        assetId={a.id}
        locked={a._count.depreciationLines + a._count.events > 0}
        data={data}
        purchaseInvoiceLabel={inv ? `${inv.number ?? ""} ${inv.supplierName} ${inv.invoiceNumber ?? ""}`.trim() : null}
        initial={{
          code: a.code,
          name: a.name,
          groupId: a.groupId,
          locationId: s(a.locationId),
          responsibleId: s(a.responsibleId),
          serialNumber: s(a.serialNumber),
          acquisitionDate: toISODate(a.acquisitionDate),
          depreciationStart: toISODate(a.depreciationStart),
          cost: a.cost.toFixed(2),
          residualValue: a.residualValue.toFixed(2),
          usefulLifeMonths: String(a.usefulLifeMonths),
          openingDepreciation: a.openingDepreciation.toFixed(2),
          openingMonths: String(a.openingMonths),
          assetAccountId: a.assetAccountId,
          accumulatedAccountId: a.accumulatedAccountId,
          expenseAccountId: a.expenseAccountId,
          departmentId: s(a.departmentId),
          purchaseInvoiceId: s(a.purchaseInvoiceId),
          notes: s(a.notes),
        }}
      />
    </div>
  );
}
