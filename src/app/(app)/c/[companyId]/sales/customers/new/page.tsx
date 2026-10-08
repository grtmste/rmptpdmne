import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { isLocale } from "@/i18n/config";
import { PageHeader } from "@/components/common/page-header";
import { CustomerForm, emptyCustomer } from "../customer-form";
import { loadCustomerFormData } from "../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("newTitle") };
}

export default async function NewCustomerPage({ params }: PageProps<"/c/[companyId]/sales/customers/new">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("customers");
  const data = await loadCustomerFormData(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <CustomerForm
        companyId={companyId}
        initial={emptyCustomer(data.baseCurrency, isLocale(data.documentLocale) ? data.documentLocale : "et")}
        groups={data.groups}
        vatRates={data.vatRates}
        currencies={data.currencies}
        defaults={data.defaults}
        canEdit
      />
    </div>
  );
}
