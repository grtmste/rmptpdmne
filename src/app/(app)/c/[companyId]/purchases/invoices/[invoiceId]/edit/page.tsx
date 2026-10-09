import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AttachmentsPanel } from "@/components/common/attachments-panel";
import { PageHeader } from "@/components/common/page-header";
import { PurchaseEditor } from "../../../purchase-editor";
import { loadPurchaseEditorData } from "../../../editor-data";
import { plainDecimal, toPurchaseLine } from "../../../purchase-line";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("purchases");
  return { title: t("editTitle") };
}

export default async function EditPurchaseInvoicePage({ params }: PageProps<"/c/[companyId]/purchases/invoices/[invoiceId]/edit">) {
  const { companyId, invoiceId } = await params;
  const ctx = await requireCompany(companyId, "purchases", "edit");
  const t = await getTranslations("purchases");
  const ti = await getTranslations("invoices");
  const invoice = await ctx.cdb.purchaseInvoice.findFirst({ where: { id: invoiceId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!invoice) notFound();
  if (invoice.status !== "DRAFT") redirect(`/c/${companyId}/purchases/invoices?doc=${invoice.id}`);
  const [data, attachments] = await Promise.all([
    loadPurchaseEditorData(ctx),
    ctx.cdb.attachment.findMany({
      where: { documentType: "PurchaseInvoice", documentId: invoice.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileName: true, contentType: true, size: true },
    }),
  ]);
  if (invoice.supplierId && !data.suppliers.some((s) => s.id === invoice.supplierId)) {
    const s = await ctx.cdb.supplier.findFirst({
      where: { id: invoice.supplierId },
      select: { id: true, name: true, regCode: true, paymentTermDays: true, currency: true, defaultAccountId: true, defaultVatRateId: true },
    });
    if (s) data.suppliers.push(s);
  }
  const dimensionOf = new Map(data.dimensions.flatMap((d) => d.values.map((v) => [v.id, d.id] as const)));
  return (
    <div className="mx-auto max-w-[96rem]">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {invoice.isCredit ? t("creditTitle") : t("editTitle")} <Badge variant="warning">{ti("statusDraft")}</Badge>
          </span>
        }
        description={invoice.source === "UPLOAD" ? t("uploadSubtitle") : ti("draftSubtitle")}
      />
      <PurchaseEditor
        companyId={companyId}
        mode="invoice"
        documentId={invoice.id}
        data={data}
        isCredit={invoice.isCredit}
        canConfirm={can(ctx.membership, "purchases", "confirm")}
        initial={{
          supplierId: invoice.supplierId ?? "",
          invoiceNumber: invoice.invoiceNumber ?? "",
          date: toISODate(invoice.date),
          dueDate: toISODate(invoice.dueDate),
          referenceNumber: invoice.referenceNumber ?? "",
          currency: invoice.currency,
          currencyRate: invoice.currency !== data.baseCurrency ? plainDecimal(invoice.currencyRate) : "",
          pricesIncludeVat: invoice.pricesIncludeVat,
          notes: invoice.notes ?? "",
          lines: invoice.lines.map((l) => toPurchaseLine(l, dimensionOf)),
        }}
        extractFrom={
          (attachments.find((a) => a.contentType === "application/pdf") ?? attachments[0])
            ? {
                url: `/c/${companyId}/attachments/${(attachments.find((a) => a.contentType === "application/pdf") ?? attachments[0])!.id}`,
                contentType: (attachments.find((a) => a.contentType === "application/pdf") ?? attachments[0])!.contentType,
                attachmentId: (attachments.find((a) => a.contentType === "application/pdf") ?? attachments[0])!.id,
              }
            : null
        }
        autoExtract={invoice.source === "UPLOAD" && !invoice.supplierId && invoice.lines.length === 0}
        side={
          <Card>
            <CardContent className="pt-5">
              <AttachmentsPanel companyId={companyId} documentType="PurchaseInvoice" documentId={invoice.id} attachments={attachments} canEdit />
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}
