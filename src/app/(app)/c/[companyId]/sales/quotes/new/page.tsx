import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { addDays, toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { SalesDocumentEditor } from "../../document-editor";
import { newLine } from "../../doc-line";
import { loadSalesEditorData } from "../../editor-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotes");
  return { title: t("newTitle") };
}

export default async function NewQuotePage({ params, searchParams }: PageProps<"/c/[companyId]/sales/quotes/new">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("quotes");
  const data = await loadSalesEditorData(ctx);
  if (data.accounts.length === 0) return <SetupRequired companyId={companyId} canEdit={can(ctx.membership, "settings", "edit")} />;
  const customer = data.customers.find((c) => c.id === sp.customer);
  const today = todayLocal();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <SalesDocumentEditor
        companyId={companyId}
        mode="quote"
        data={data}
        canConfirm={false}
        initial={{
          customerId: customer?.id ?? "",
          date: toISODate(today),
          dueDate: "",
          validUntil: toISODate(addDays(today, 14)),
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
