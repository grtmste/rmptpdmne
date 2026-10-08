"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileOutput, MoreHorizontal, Pencil, Send, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useActionRunner } from "@/components/common/use-action";
import { deleteQuote, quoteToInvoiceAction, sendQuote, setQuoteStatus } from "@/server/actions/sales";
import { SendDocumentDialog, type EmailDraft } from "../send-dialog";

type Status = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "INVOICED";
const BADGE = { DRAFT: "warning", SENT: "secondary", ACCEPTED: "success", REJECTED: "destructive", INVOICED: "outline" } as const;

export type QuotePreviewData = {
  id: string;
  number: string;
  status: Status;
  customerId: string;
  customerName: string;
  date: string;
  validUntil: string | null;
  currency: string;
  netTotal: string;
  vatTotal: string;
  total: string;
  notes: string | null;
  invoice: { id: string; number: string | null } | null;
  lines: Array<{ id: string; description: string; quantity: string; unit: string | null; unitPrice: string; vat: string; netAmount: string }>;
  emails: Array<{ id: string; to: string; status: "SENT" | "FAILED"; createdAt: string }>;
  email: EmailDraft;
};

export function QuotePreview({
  companyId,
  quote,
  closeHref,
  canEdit,
  today,
}: {
  companyId: string;
  quote: QuotePreviewData;
  closeHref: string;
  canEdit: boolean;
  today: string;
}) {
  const t = useTranslations("quotes");
  const ti = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [sendOpen, setSendOpen] = useState(false);
  const base = `/c/${companyId}/sales/quotes`;
  const pdfHref = `${base}/${quote.id}/pdf`;
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);
  const money = (v: string) => formatMoney(v, locale);
  const invoiced = quote.status === "INVOICED";

  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{quote.number}</h2>
            <Badge variant={BADGE[quote.status]}>{t(`statuses.${quote.status}`)}</Badge>
          </div>
          <p className="text-sm">
            <Link className="font-medium hover:underline" href={`/c/${companyId}/sales/customers/${quote.customerId}`}>
              {quote.customerName}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {fmt(quote.date)}
              {quote.validUntil ? ` · ${t("validUntilShort", { date: fmt(quote.validUntil) })}` : ""}
            </span>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-b px-5 py-3">
        {canEdit && !invoiced && (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => quoteToInvoiceAction(companyId, { id: quote.id, date: today }), {
                  success: t("invoiceCreated"),
                  refresh: false,
                  onSuccess: (d) => router.push(`/c/${companyId}/sales/invoices/${d.id}/edit`),
                })
              }
            >
              <FileOutput /> {t("toInvoice")}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`${base}/${quote.id}/edit`}>
                <Pencil /> {ti("edit")}
              </Link>
            </Button>
          </>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Send /> {ti("send")}
          </Button>
        )}
        <Button size="sm" variant="outline" asChild>
          <a href={pdfHref} target="_blank" rel="noreferrer">
            <Download /> PDF
          </a>
        </Button>
        {canEdit && !invoiced && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={ti("moreActions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("markAs")}</DropdownMenuLabel>
              {(["SENT", "ACCEPTED", "REJECTED", "DRAFT"] as const)
                .filter((s) => s !== quote.status)
                .map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => run(() => setQuoteStatus(companyId, { id: quote.id, status: s }))}>
                    {t(`statuses.${s}`)}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() =>
                  confirm(t("deleteConfirm", { number: quote.number })) &&
                  run(() => deleteQuote(companyId, { id: quote.id }), { success: t("deleted"), refresh: false, onSuccess: () => router.push(closeHref) })
                }
              >
                <Trash2 /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {quote.invoice && (
        <div className="border-b bg-muted/40 px-5 py-2 text-sm">
          {t("invoicedAs")}{" "}
          <Link className="font-mono text-primary hover:underline" href={`/c/${companyId}/sales/invoices?doc=${quote.invoice.id}`}>
            {quote.invoice.number ?? ti("draftNumber")}
          </Link>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">{ti("description")}</th>
              <th className="px-2 py-2 text-right font-medium">{ti("quantity")}</th>
              <th className="px-2 py-2 text-right font-medium">{ti("price")}</th>
              <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">{ti("vat")}</th>
              <th className="px-5 py-2 text-right font-medium">{ti("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {quote.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-5 py-1.5">{l.description}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {formatMoney(l.quantity, locale, { scale: Math.min(4, dec(l.quantity).decimalPlaces()) })} {l.unit}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatMoney(l.unitPrice, locale, { scale: Math.max(2, Math.min(4, dec(l.unitPrice).decimalPlaces())) })}
                </td>
                <td className="hidden px-2 py-1.5 text-xs text-muted-foreground sm:table-cell">{l.vat}</td>
                <td className="px-5 py-1.5 text-right tabular-nums">{money(l.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="space-y-1 border-t px-5 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("net")}</dt>
          <dd className="tabular-nums">{money(quote.netTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("vatTotal")}</dt>
          <dd className="tabular-nums">{money(quote.vatTotal)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{ti("total")}</dt>
          <dd className="tabular-nums">
            {money(quote.total)} {quote.currency}
          </dd>
        </div>
      </dl>
      {quote.notes && <p className="border-t px-5 py-3 text-sm whitespace-pre-line text-muted-foreground">{quote.notes}</p>}
      {quote.emails.length > 0 && (
        <div className="space-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
          {quote.emails.map((e) => (
            <p key={e.id} className={e.status === "FAILED" ? "text-destructive" : undefined}>
              {e.status === "SENT" ? ti("emailSent", { to: e.to, date: formatDate(new Date(e.createdAt), locale) }) : ti("emailFailed", { to: e.to })}
            </p>
          ))}
        </div>
      )}
      {sendOpen && (
        <SendDocumentDialog
          title={t("sendTitle", { number: quote.number })}
          initial={quote.email}
          attachment={`${quote.number}.pdf`}
          pdfHref={pdfHref}
          onClose={() => setSendOpen(false)}
          send={(values) => sendQuote(companyId, { id: quote.id, ...values })}
        />
      )}
    </Card>
  );
}
