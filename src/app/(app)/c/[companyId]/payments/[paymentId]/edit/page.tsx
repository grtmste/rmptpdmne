import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { PageHeader } from "@/components/common/page-header";
import { PaymentForm, type PaymentValues } from "../../payment-form";
import { loadPaymentFormData } from "../../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments");
  return { title: t("editTitle") };
}

export default async function EditPaymentPage({ params }: PageProps<"/c/[companyId]/payments/[paymentId]/edit">) {
  const { companyId, paymentId } = await params;
  const ctx = await requireCompany(companyId, "payments", "edit");
  const t = await getTranslations("payments");
  const p = await ctx.cdb.payment.findFirst({ where: { id: paymentId }, include: { allocations: { orderBy: { sortOrder: "asc" } } } });
  if (!p) notFound();
  if (p.status !== "DRAFT") redirect(`/c/${companyId}/payments?doc=${p.id}`);
  const data = await loadPaymentFormData(ctx);
  const docIds = {
    sales: p.allocations.flatMap((a) => (a.salesInvoiceId ? [a.salesInvoiceId] : [])),
    purchase: p.allocations.flatMap((a) => (a.purchaseInvoiceId ? [a.purchaseInvoiceId] : [])),
    expense: p.allocations.flatMap((a) => (a.expenseReportId ? [a.expenseReportId] : [])),
  };
  const [sales, purchases, expenses] = await Promise.all([
    ctx.cdb.salesInvoice.findMany({ where: { id: { in: docIds.sales } }, select: { id: true, number: true } }),
    ctx.cdb.purchaseInvoice.findMany({ where: { id: { in: docIds.purchase } }, select: { id: true, number: true } }),
    ctx.cdb.expenseReport.findMany({ where: { id: { in: docIds.expense } }, select: { id: true, number: true } }),
  ]);
  const numbers = new Map([...sales, ...purchases, ...expenses].map((d) => [d.id, d.number ?? ""]));
  const values: PaymentValues = {
    direction: p.direction,
    bankAccountId: p.bankAccountId ?? data.bankAccounts[0]?.id ?? "",
    date: toISODate(p.date),
    amount: p.direction === "NETTING" ? "" : p.amount.toFixed(2),
    partyType: p.partyType,
    partyId: p.customerId ?? p.supplierId ?? p.employeeId ?? "",
    partyName: p.partyName,
    referenceNumber: p.referenceNumber ?? "",
    description: p.description ?? "",
    docs: Object.fromEntries(
      p.allocations
        .filter((a) => a.salesInvoiceId || a.purchaseInvoiceId || a.expenseReportId)
        .map((a) => {
          const id = (a.salesInvoiceId ?? a.purchaseInvoiceId ?? a.expenseReportId)!;
          return [id, { type: a.type as "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT", amount: a.amount.toFixed(2), number: numbers.get(id) ?? "" }];
        }),
    ),
    prepayment: p.allocations.find((a) => a.type === "PREPAYMENT")?.amount.toFixed(2) ?? "",
    accountLines: p.allocations
      .filter((a) => a.type === "ACCOUNT")
      .map((a) => ({ key: a.id, accountId: a.accountId ?? "", amount: a.amount.toFixed(2), description: a.description ?? "" })),
  };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("editTitle")} description={t("draftSubtitle")} />
      <PaymentForm companyId={companyId} paymentId={p.id} data={data} initial={values} canConfirm={can(ctx.membership, "payments", "confirm")} />
    </div>
  );
}
