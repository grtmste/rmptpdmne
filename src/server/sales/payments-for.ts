import "server-only";
import type { CompanyContext } from "@/server/session";
import { toISODate } from "@/lib/accounting/dates";
import type { DocumentPayment } from "@/components/common/payment-status";

/** Dokumendiga seotud kinnitatud maksed eelvaate jaoks. */
export async function paymentsFor(ctx: CompanyContext, field: "salesInvoiceId" | "purchaseInvoiceId" | "expenseReportId", id: string): Promise<DocumentPayment[]> {
  const allocations = await ctx.cdb.paymentAllocation.findMany({
    where: { [field]: id, payment: { status: "CONFIRMED" } },
    include: { payment: { select: { id: true, number: true, date: true, direction: true, cancelledAt: true } } },
    orderBy: { payment: { date: "asc" } },
  });
  return allocations.map((a) => ({
    id: a.payment.id,
    number: a.payment.number,
    date: toISODate(a.payment.date),
    direction: a.payment.direction,
    amount: a.amount.toFixed(2),
    cancelled: Boolean(a.payment.cancelledAt),
  }));
}
