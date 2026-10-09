import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate, addDays } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatIban } from "@/lib/iban";
import { formatMoney } from "@/lib/money";
import { db } from "@/lib/db";
import { openItems } from "@/server/services/payments";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { OrderBuilder, OrderActions, type PayableRow } from "./order-builder";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.payments.orders") };
}

export default async function PaymentOrdersPage({ params }: PageProps<"/c/[companyId]/payments/orders">) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId, "payments");
  const t = await getTranslations("paymentOrders");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const [items, banks, orders] = await Promise.all([
    openItems(db, ctx.company.id, { types: ["PURCHASE_INVOICE", "EXPENSE_REPORT"], limit: 500 }),
    ctx.cdb.bankAccount.findMany({ where: { kind: "BANK", active: true, iban: { not: null } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    ctx.cdb.paymentOrder.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { lines: true } } } }),
  ]);
  // Saaja IBAN: ostuarvel salvestatud või aruandva isiku oma
  const [purchases, reports] = await Promise.all([
    ctx.cdb.purchaseInvoice.findMany({ where: { id: { in: items.filter((i) => i.type === "PURCHASE_INVOICE").map((i) => i.id) } }, select: { id: true, bankAccount: true } }),
    ctx.cdb.expenseReport.findMany({ where: { id: { in: items.filter((i) => i.type === "EXPENSE_REPORT").map((i) => i.id) } }, select: { id: true, employee: { select: { bankAccount: true } } } }),
  ]);
  const iban = new Map<string, string | null>([...purchases.map((p) => [p.id, p.bankAccount] as const), ...reports.map((r) => [r.id, r.employee.bankAccount] as const)]);
  const rows: PayableRow[] = items
    .filter((i) => !i.open.startsWith("-"))
    .map((i) => ({
      type: i.type as PayableRow["type"],
      id: i.id,
      number: i.number,
      invoiceNumber: i.invoiceNumber ?? null,
      partyName: i.partyName,
      dueDate: i.dueDate ? toISODate(i.dueDate) : null,
      open: i.open,
      currency: i.currency,
      iban: iban.get(i.id) ? formatIban(iban.get(i.id)!) : null,
    }));
  const canConfirm = can(ctx.membership, "payments", "confirm");
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title={tn("items.payments.orders")} description={t("subtitle")} />
      <OrderBuilder companyId={companyId} rows={rows} banks={banks} canConfirm={canConfirm} defaultDate={toISODate(addDays(todayLocal(), 1))} />
      <Card>
        <CardHeader>
          <CardTitle>{t("history")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {orders.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-muted-foreground">{t("noOrders")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{o.messageId}</span>
                      <Badge variant={o.status === "PAID" ? "success" : "warning"}>{t(`statuses.${o.status}`)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("executionOn", { date: formatDate(o.executionDate, locale) })} · {t("lineCount", { count: o._count.lines })}
                    </div>
                  </div>
                  <span className="font-medium tabular-nums">{formatMoney(o.total, locale)}</span>
                  <OrderActions companyId={companyId} orderId={o.id} paid={o.status === "PAID"} canConfirm={canConfirm} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
