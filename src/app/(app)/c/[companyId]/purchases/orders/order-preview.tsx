"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FileOutput, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActionRunner } from "@/components/common/use-action";
import { deletePurchaseOrder, orderToInvoiceAction, setPurchaseOrderStatus } from "@/server/actions/purchases";

type Status = "DRAFT" | "ORDERED" | "RECEIVED" | "INVOICED" | "CANCELLED";
const BADGE = { DRAFT: "warning", ORDERED: "secondary", RECEIVED: "success", INVOICED: "outline", CANCELLED: "destructive" } as const;

export type OrderPreviewData = {
  id: string;
  number: string;
  status: Status;
  supplierId: string;
  supplierName: string;
  date: string;
  expectedDate: string | null;
  currency: string;
  netTotal: string;
  vatTotal: string;
  total: string;
  notes: string | null;
  invoice: { id: string; number: string | null } | null;
  lines: Array<{ id: string; description: string; quantity: string; unit: string | null; unitPrice: string; netAmount: string }>;
};

export function OrderPreview({ companyId, order, closeHref, canEdit, today }: { companyId: string; order: OrderPreviewData; closeHref: string; canEdit: boolean; today: string }) {
  const t = useTranslations("orders");
  const ti = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const base = `/c/${companyId}/purchases/orders`;
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);
  const money = (v: string) => formatMoney(v, locale);
  const invoiced = order.status === "INVOICED";
  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{order.number}</h2>
            <Badge variant={BADGE[order.status]}>{t(`statuses.${order.status}`)}</Badge>
          </div>
          <p className="text-sm">
            <Link className="font-medium hover:underline" href={`/c/${companyId}/purchases/suppliers/${order.supplierId}`}>
              {order.supplierName}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {fmt(order.date)}
              {order.expectedDate ? ` · ${t("expectedShort", { date: fmt(order.expectedDate) })}` : ""}
            </span>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>
      {canEdit && !invoiced && (
        <div className="flex flex-wrap gap-2 border-b px-5 py-3">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => orderToInvoiceAction(companyId, { id: order.id, date: today }), {
                success: t("invoiceCreated"),
                refresh: false,
                onSuccess: (d) => router.push(`/c/${companyId}/purchases/invoices/${d.id}/edit`),
              })
            }
          >
            <FileOutput /> {t("toInvoice")}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`${base}/${order.id}/edit`}>
              <Pencil /> {ti("edit")}
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={ti("moreActions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("markAs")}</DropdownMenuLabel>
              {(["ORDERED", "RECEIVED", "CANCELLED", "DRAFT"] as const)
                .filter((s) => s !== order.status)
                .map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => run(() => setPurchaseOrderStatus(companyId, { id: order.id, status: s }))}>
                    {t(`statuses.${s}`)}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() =>
                  confirm(t("deleteConfirm", { number: order.number })) &&
                  run(() => deletePurchaseOrder(companyId, { id: order.id }), { success: t("deleted"), refresh: false, onSuccess: () => router.push(closeHref) })
                }
              >
                <Trash2 /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {order.invoice && (
        <div className="border-b bg-muted/40 px-5 py-2 text-sm">
          {t("invoicedAs")}{" "}
          <Link className="font-mono text-primary hover:underline" href={`/c/${companyId}/purchases/invoices?doc=${order.invoice.id}`}>
            {order.invoice.number ?? ti("draftNumber")}
          </Link>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left font-medium">{ti("description")}</th>
            <th className="px-2 py-2 text-right font-medium">{ti("quantity")}</th>
            <th className="px-2 py-2 text-right font-medium">{ti("price")}</th>
            <th className="px-5 py-2 text-right font-medium">{ti("amount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {order.lines.map((l) => (
            <tr key={l.id}>
              <td className="px-5 py-1.5">{l.description}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {formatMoney(l.quantity, locale, { scale: Math.min(4, dec(l.quantity).decimalPlaces()) })} {l.unit}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(l.unitPrice, locale, { scale: Math.max(2, Math.min(4, dec(l.unitPrice).decimalPlaces())) })}</td>
              <td className="px-5 py-1.5 text-right tabular-nums">{money(l.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="space-y-1 border-t px-5 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("net")}</dt>
          <dd className="tabular-nums">{money(order.netTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("vatTotal")}</dt>
          <dd className="tabular-nums">{money(order.vatTotal)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{ti("total")}</dt>
          <dd className="tabular-nums">
            {money(order.total)} {order.currency}
          </dd>
        </div>
      </dl>
      {order.notes && <p className="border-t px-5 py-3 text-sm whitespace-pre-line text-muted-foreground">{order.notes}</p>}
    </Card>
  );
}
