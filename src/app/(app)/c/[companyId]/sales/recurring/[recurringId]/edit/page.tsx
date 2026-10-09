import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { SalesDocumentEditor } from "../../../document-editor";
import { loadSalesEditorData } from "../../../editor-data";
import { toDocValues } from "../../../doc-values";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recurring");
  return { title: t("editTitle") };
}

export default async function EditRecurringPage({ params }: PageProps<"/c/[companyId]/sales/recurring/[recurringId]/edit">) {
  const { companyId, recurringId } = await params;
  const ctx = await requireCompany(companyId, "sales", "edit");
  const t = await getTranslations("recurring");
  const r = await ctx.cdb.recurringInvoice.findFirst({ where: { id: recurringId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!r) notFound();
  const data = await loadSalesEditorData(ctx);
  const dimensionOf = new Map(data.dimensions.flatMap((d) => d.values.map((v) => [v.id, d.id] as const)));
  const values = toDocValues(
    { ...r, date: r.startDate, lines: r.lines.map((l) => ({ ...l, unitCost: null })) },
    dimensionOf,
  );
  if (!data.customers.some((c) => c.id === r.customerId)) {
    const c = await ctx.cdb.customer.findFirst({
      where: { id: r.customerId },
      select: { id: true, name: true, regCode: true, email: true, paymentTermDays: true, currency: true, defaultVatRateId: true },
    });
    if (c) data.customers.push(c);
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("editNamed", { name: r.name })} description={t("editSubtitle")} />
      <SalesDocumentEditor
        companyId={companyId}
        mode="recurring"
        documentId={r.id}
        data={data}
        canConfirm={false}
        initial={values}
        recurring={{
          name: r.name,
          intervalMonths: String(r.intervalMonths),
          endDate: r.endDate ? toISODate(r.endDate) : "",
          mode: r.mode,
          paymentTermDays: r.paymentTermDays === null ? "" : String(r.paymentTermDays),
          active: r.active,
        }}
      />
    </div>
  );
}
