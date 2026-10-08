import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { addDays, toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { SalesDocumentEditor } from "../../document-editor";
import { newLine } from "../../doc-line";
import { loadSalesEditorData } from "../../editor-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("newTitle") };
}

export default async function NewInvoicePage({ params, searchParams }: PageProps<"/c/[companyId]/sales/invoices/new">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("invoices");
  const type = sp.type === "PREPAYMENT" ? "PREPAYMENT" : "INVOICE";
  const data = await loadSalesEditorData(ctx, { prepayments: type === "INVOICE" });
  if (data.accounts.length === 0) return <SetupRequired companyId={companyId} canEdit={can(ctx.membership, "settings", "edit")} />;
  const customer = data.customers.find((c) => c.id === sp.customer);
  const today = todayLocal();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={type === "PREPAYMENT" ? t("newPrepaymentTitle") : t("newTitle")} description={type === "PREPAYMENT" ? t("prepaymentSubtitle") : t("newSubtitle")} />
      <SalesDocumentEditor
        companyId={companyId}
        mode="invoice"
        type={type}
        data={data}
        canConfirm={can(ctx.membership, "sales", "confirm")}
        initial={{
          customerId: customer?.id ?? "",
          date: toISODate(today),
          dueDate: toISODate(addDays(today, customer?.paymentTermDays ?? data.paymentTermDays)),
          validUntil: "",
          deliveryDate: "",
          currency: customer?.currency ?? data.baseCurrency,
          currencyRate: "",
          pricesIncludeVat: false,
          yourReference: "",
          notes: "",
          lines: [newLine({ vatRateId: customer?.defaultVatRateId ?? data.defaultVatRateId ?? "" })],
        }}
      />
    </div>
  );
}
