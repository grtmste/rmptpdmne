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
  const t = await getTranslations("orders");
  return { title: t("newTitle") };
}

export default async function NewOrderPage({ params }: PageProps<"/c/[companyId]/purchases/orders/new">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("orders");
  const data = await loadPurchaseEditorData(ctx);
  if (data.accounts.length === 0) return <SetupRequired companyId={companyId} canEdit={can(ctx.membership, "settings", "edit")} />;
  const today = todayLocal();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <PurchaseEditor
        companyId={companyId}
        mode="order"
        data={data}
        canConfirm={false}
        initial={{
          supplierId: "",
          invoiceNumber: "",
          date: toISODate(today),
          dueDate: toISODate(addDays(today, 7)),
          referenceNumber: "",
          currency: data.baseCurrency,
          currencyRate: "",
          pricesIncludeVat: false,
          notes: "",
          lines: [newPurchaseLine({ vatRateId: data.defaultVatRateId ?? "" })],
        }}
      />
    </div>
  );
}
