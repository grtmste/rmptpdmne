import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { PageHeader } from "@/components/common/page-header";
import { SupplierForm, emptySupplier } from "../supplier-form";
import { loadSupplierFormData } from "../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("suppliers");
  return { title: t("newTitle") };
}

export default async function NewSupplierPage({ params }: PageProps<"/c/[companyId]/purchases/suppliers/new">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("suppliers");
  const data = await loadSupplierFormData(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <SupplierForm companyId={companyId} initial={emptySupplier(data.baseCurrency)} canEdit {...data} />
    </div>
  );
}
