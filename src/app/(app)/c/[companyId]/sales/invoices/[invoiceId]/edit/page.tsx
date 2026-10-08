import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { SalesDocumentEditor } from "../../../document-editor";
import { loadSalesEditorData } from "../../../editor-data";
import { toDocValues } from "../../../doc-values";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("editTitle") };
}

export default async function EditInvoicePage({ params }: PageProps<"/c/[companyId]/sales/invoices/[invoiceId]/edit">) {
  const { companyId, invoiceId } = await params;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("invoices");
  const invoice = await ctx.cdb.salesInvoice.findFirst({
    where: { id: invoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, creditOf: { select: { id: true, number: true, date: true } } },
  });
  if (!invoice) notFound();
  if (invoice.status !== "DRAFT") redirect(`/c/${companyId}/sales/invoices?doc=${invoice.id}`);
  const data = await loadSalesEditorData(ctx, { prepayments: invoice.type === "INVOICE" });
  // Juba sellel arvel olevad ettemaksud peavad jääma valikusse (kuupäev määra jaoks)
  const dimensionOf = new Map(data.dimensions.flatMap((d) => d.values.map((v) => [v.id, d.id] as const)));
  const values = toDocValues(invoice, dimensionOf, { keepRate: true });
  if (invoice.customerId && !data.customers.some((c) => c.id === invoice.customerId)) {
    const c = await ctx.cdb.customer.findFirst({
      where: { id: invoice.customerId },
      select: { id: true, name: true, regCode: true, email: true, paymentTermDays: true, currency: true, defaultVatRateId: true },
    });
    if (c) data.customers.push(c);
  }
  const usedPrepayments = invoice.lines.map((l) => l.prepaymentInvoiceId).filter((x): x is string => Boolean(x));
  if (usedPrepayments.length) {
    const missing = usedPrepayments.filter((id) => !data.prepayments.some((p) => p.id === id));
    const rows = await ctx.cdb.salesInvoice.findMany({ where: { id: { in: missing } }, select: { id: true, number: true, customerId: true, date: true } });
    data.prepayments.push(...rows.map((r) => ({ id: r.id, number: r.number ?? "", customerId: r.customerId, date: toISODate(r.date), remaining: [] })));
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {t(`editTitles.${invoice.type}`)} <Badge variant="warning">{t("statusDraft")}</Badge>
          </span>
        }
        description={t("draftSubtitle")}
      />
      <SalesDocumentEditor
        companyId={companyId}
        mode="invoice"
        type={invoice.type}
        documentId={invoice.id}
        data={data}
        canConfirm={can(ctx.membership, "sales", "confirm")}
        initial={values}
        rateDate={invoice.creditOf ? toISODate(invoice.creditOf.date) : undefined}
        creditOf={invoice.creditOf ? { id: invoice.creditOf.id, number: invoice.creditOf.number ?? "" } : null}
        taxFree={invoice.taxFree}
      />
    </div>
  );
}
