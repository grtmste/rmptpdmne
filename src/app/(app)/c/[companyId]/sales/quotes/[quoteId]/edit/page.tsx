import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { PageHeader } from "@/components/common/page-header";
import { SalesDocumentEditor } from "../../../document-editor";
import { loadSalesEditorData } from "../../../editor-data";
import { toDocValues } from "../../../doc-values";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotes");
  return { title: t("editTitle") };
}

export default async function EditQuotePage({ params }: PageProps<"/c/[companyId]/sales/quotes/[quoteId]/edit">) {
  const { companyId, quoteId } = await params;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("quotes");
  const quote = await ctx.cdb.quote.findFirst({ where: { id: quoteId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!quote) notFound();
  if (quote.status === "INVOICED") redirect(`/c/${companyId}/sales/quotes?doc=${quote.id}`);
  const data = await loadSalesEditorData(ctx);
  if (!data.customers.some((c) => c.id === quote.customerId)) {
    const c = await ctx.cdb.customer.findFirst({
      where: { id: quote.customerId },
      select: { id: true, name: true, regCode: true, email: true, paymentTermDays: true, currency: true, defaultVatRateId: true },
    });
    if (c) data.customers.push(c);
  }
  const dimensionOf = new Map(data.dimensions.flatMap((d) => d.values.map((v) => [v.id, d.id] as const)));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`${t("editTitle")} ${quote.number}`} description={t("editSubtitle")} />
      <SalesDocumentEditor
        companyId={companyId}
        mode="quote"
        documentId={quote.id}
        data={data}
        canConfirm={false}
        initial={toDocValues(quote, dimensionOf)}
      />
    </div>
  );
}
