import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { dec } from "@/lib/money";
import { PageHeader } from "@/components/common/page-header";
import { PaymentForm, type PaymentValues } from "../payment-form";
import { loadPaymentFormData } from "../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments");
  return { title: t("newTitle") };
}

/** Uus makse; ?salesInvoice=, ?purchaseInvoice= või ?expenseReport= täidab arve ja osapoole ette. */
export default async function NewPaymentPage({ params, searchParams }: PageProps<"/c/[companyId]/payments/new">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "payments", "edit");
  const t = await getTranslations("payments");
  const data = await loadPaymentFormData(ctx);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const direction = str(sp.direction) === "OUT" ? "OUT" : str(sp.direction) === "NETTING" ? "NETTING" : "IN";
  const values: PaymentValues = {
    direction,
    bankAccountId: data.bankAccounts[0]?.id ?? "",
    date: toISODate(todayLocal()),
    amount: "",
    partyType: direction === "OUT" ? "SUPPLIER" : "CUSTOMER",
    partyId: "",
    partyName: "",
    referenceNumber: "",
    description: "",
    docs: {},
    prepayment: "",
    accountLines: [],
  };
  const open = (total: { toString(): string }, paid: { toString(): string }) => dec(total.toString()).minus(dec(paid.toString())).toFixed(2);
  if (str(sp.salesInvoice)) {
    const inv = await ctx.cdb.salesInvoice.findFirst({ where: { id: str(sp.salesInvoice), status: "CONFIRMED" } });
    if (inv) {
      const amount = open(inv.total, inv.paidTotal);
      Object.assign(values, {
        direction: dec(amount).isNegative() ? "OUT" : "IN",
        partyType: "CUSTOMER",
        partyId: inv.customerId,
        amount: dec(amount).abs().toFixed(2),
        referenceNumber: inv.referenceNumber ?? "",
        docs: { [inv.id]: { type: "SALES_INVOICE", amount, number: inv.number ?? "" } },
      });
    }
  } else if (str(sp.purchaseInvoice)) {
    const inv = await ctx.cdb.purchaseInvoice.findFirst({ where: { id: str(sp.purchaseInvoice), status: "CONFIRMED" } });
    if (inv) {
      const amount = open(inv.total, inv.paidTotal);
      Object.assign(values, {
        direction: dec(amount).isNegative() ? "IN" : "OUT",
        partyType: "SUPPLIER",
        partyId: inv.supplierId ?? "",
        amount: dec(amount).abs().toFixed(2),
        referenceNumber: inv.referenceNumber ?? "",
        docs: { [inv.id]: { type: "PURCHASE_INVOICE", amount, number: inv.number ?? "" } },
      });
    }
  } else if (str(sp.expenseReport)) {
    const rep = await ctx.cdb.expenseReport.findFirst({ where: { id: str(sp.expenseReport), status: "CONFIRMED" } });
    if (rep) {
      const amount = open(rep.total, rep.paidTotal);
      Object.assign(values, {
        direction: "OUT",
        partyType: "EMPLOYEE",
        partyId: rep.employeeId,
        amount,
        docs: { [rep.id]: { type: "EXPENSE_REPORT", amount, number: rep.number ?? "" } },
      });
    }
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("newTitle")} description={t("newSubtitle")} />
      <PaymentForm companyId={companyId} data={data} initial={values} canConfirm={can(ctx.membership, "payments", "confirm")} />
    </div>
  );
}
