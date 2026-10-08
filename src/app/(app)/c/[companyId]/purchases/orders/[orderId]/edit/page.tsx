import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { PurchaseEditor } from "../../../purchase-editor";
import { loadPurchaseEditorData } from "../../../editor-data";
import { toPurchaseLine } from "../../../purchase-line";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("orders");
  return { title: t("editTitle") };
}

export default async function EditOrderPage({ params }: PageProps<"/c/[companyId]/purchases/orders/[orderId]/edit">) {
  const { companyId, orderId } = await params;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("orders");
  const order = await ctx.cdb.purchaseOrder.findFirst({ where: { id: orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!order) notFound();
  if (order.status === "INVOICED") redirect(`/c/${companyId}/purchases/orders?doc=${order.id}`);
  const data = await loadPurchaseEditorData(ctx);
  if (!data.suppliers.some((s) => s.id === order.supplierId)) {
    const s = await ctx.cdb.supplier.findFirst({
      where: { id: order.supplierId },
      select: { id: true, name: true, regCode: true, paymentTermDays: true, currency: true, defaultAccountId: true, defaultVatRateId: true },
    });
    if (s) data.suppliers.push(s);
  }
  const dimensionOf = new Map(data.dimensions.flatMap((d) => d.values.map((v) => [v.id, d.id] as const)));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`${t("editTitle")} ${order.number}`} description={t("editSubtitle")} />
      <PurchaseEditor
        companyId={companyId}
        mode="order"
        documentId={order.id}
        data={data}
        canConfirm={false}
        initial={{
          supplierId: order.supplierId,
          invoiceNumber: "",
          date: toISODate(order.date),
          dueDate: order.expectedDate ? toISODate(order.expectedDate) : "",
          referenceNumber: "",
          currency: order.currency,
          currencyRate: "",
          pricesIncludeVat: order.pricesIncludeVat,
          notes: order.notes ?? "",
          lines: order.lines.map((l) => toPurchaseLine({ ...l, id: l.id }, dimensionOf)),
        }}
      />
    </div>
  );
}
