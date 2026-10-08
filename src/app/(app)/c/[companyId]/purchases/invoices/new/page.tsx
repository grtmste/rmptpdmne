import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { addDays, toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { PageHeader } from "@/components/common/page-header";
import { SetupRequired } from "@/components/common/setup-required";
import { PurchaseEditor } from "../../purchase-editor";
import { loadPurchaseEditorData } from "../../editor-data";
import { newPurchaseLine } from "../../purchase-line";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("purchases");
  return { title: t("newTitle") };
}

export default async function NewPurchaseInvoicePage({ params, searchParams }: PageProps<"/c/[companyId]/purchases/invoices/new">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("purchases");
  const data = await loadPurchaseEditorData(ctx);
  if (data.accounts.length === 0) return <SetupRequired companyId={companyId} canEdit={can(ctx.membership, "settings", "edit")} />;
  const supplier = data.suppliers.find((s) => s.id === sp.supplier);
  const today = todayLocal();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <PurchaseEditor
        companyId={companyId}
        mode="invoice"
        data={data}
        canConfirm={can(ctx.membership, "purchases", "confirm")}
        initial={{
          supplierId: supplier?.id ?? "",
          invoiceNumber: "",
          date: toISODate(today),
          dueDate: toISODate(addDays(today, supplier?.paymentTermDays ?? data.paymentTermDays)),
          referenceNumber: "",
          currency: supplier?.currency ?? data.baseCurrency,
          currencyRate: "",
          pricesIncludeVat: false,
          notes: "",
          lines: [
            newPurchaseLine({
              vatRateId: supplier?.defaultVatRateId ?? data.defaultVatRateId ?? "",
              accountId: supplier?.defaultAccountId ?? "",
            }),
          ],
        }}
      />
    </div>
  );
}
