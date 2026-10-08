"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, CheckCircle2, Copy, Download, FileMinus2, MoreHorizontal, Pencil, Plane, Send, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import {
  confirmSalesInvoiceById,
  copySalesInvoice,
  creditSalesInvoice,
  deleteSalesInvoice,
  sendSalesInvoice,
  taxFreeSalesInvoice,
} from "@/server/actions/sales";
import { SendDocumentDialog, type EmailDraft } from "../send-dialog";

export type InvoicePreviewData = {
  id: string;
  type: "INVOICE" | "CREDIT" | "PREPAYMENT";
  status: "DRAFT" | "CONFIRMED";
  number: string | null;
  customerId: string;
  customerName: string;
  customerAddress: string | null;
  customerRegCode: string | null;
  date: string;
  dueDate: string;
  referenceNumber: string | null;
  currency: string;
  currencyRate: string | null;
  netTotal: string;
  vatTotal: string;
  total: string;
  totalBase: string;
  notes: string | null;
  taxFree: boolean;
  sentAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  creditOf: { id: string; number: string | null } | null;
  credits: Array<{ id: string; number: string | null; status: string; taxFree: boolean }>;
  quote: { id: string; number: string } | null;
  journal: { id: string; number: string | null } | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unit: string | null;
    unitPrice: string;
    discountPct: string;
    vat: string;
    amount: string;
    netAmount: string;
  }>;
  emails: Array<{ id: string; to: string; status: "SENT" | "FAILED"; createdAt: string; error: string | null }>;
  email: EmailDraft | null;
};

export function InvoicePreview({
  companyId,
  invoice,
  closeHref,
  canEdit,
  canConfirm,
  canViewLedger,
  today,
}: {
  companyId: string;
  invoice: InvoicePreviewData;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  canViewLedger: boolean;
  today: string;
}) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [dateAction, setDateAction] = useState<"credit" | "taxFree" | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const base = `/c/${companyId}/sales/invoices`;
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);
  const money = (v: string) => formatMoney(v, locale);
  const isDraft = invoice.status === "DRAFT";
  const pdfHref = `${base}/${invoice.id}/pdf`;
  const qty = (v: string) => formatMoney(v, locale, { scale: Math.min(4, dec(v).decimalPlaces()) });
  const price = (v: string) => formatMoney(v, locale, { scale: Math.max(2, Math.min(4, dec(v).decimalPlaces())) });
  const goTo = (id: string) => router.push(`${base}/${id}/edit`);

  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{invoice.number ?? t("draftNumber")}</h2>
            <Badge variant={isDraft ? "warning" : "success"}>{isDraft ? t("statusDraft") : t("statusConfirmed")}</Badge>
            {invoice.type !== "INVOICE" && <Badge variant="outline">{invoice.taxFree ? t("taxFree") : t(`types.${invoice.type}`)}</Badge>}
            {invoice.sentAt && <Badge variant="secondary">{t("sent")}</Badge>}
          </div>
          <p className="text-sm">
            <Link className="font-medium hover:underline" href={`/c/${companyId}/sales/customers/${invoice.customerId}`}>
              {invoice.customerName}
            </Link>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={t("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-b px-5 py-3">
        {isDraft && canEdit && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`${base}/${invoice.id}/edit`}>
              <Pencil /> {t("edit")}
            </Link>
          </Button>
        )}
        {isDraft && canConfirm && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => confirmSalesInvoiceById(companyId, { id: invoice.id }), { success: t("confirmed") })}
          >
            <CheckCircle2 /> {t("confirm")}
          </Button>
        )}
        {!isDraft && canEdit && invoice.email && (
          <Button size="sm" onClick={() => setSendOpen(true)}>
            <Send /> {t("send")}
          </Button>
        )}
        <Button size="sm" variant="outline" asChild>
          <a href={pdfHref} target="_blank" rel="noreferrer">
            <Download /> PDF
          </a>
        </Button>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t("moreActions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isDraft && invoice.type !== "CREDIT" && (
                <DropdownMenuItem onSelect={() => setDateAction("credit")}>
                  <FileMinus2 /> {t("createCredit")}
                </DropdownMenuItem>
              )}
              {!isDraft && invoice.type === "INVOICE" && (
                <DropdownMenuItem onSelect={() => setDateAction("taxFree")}>
                  <Plane /> {t("createTaxFree")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  run(() => copySalesInvoice(companyId, { id: invoice.id, date: today }), {
                    success: t("copied"),
                    refresh: false,
                    onSuccess: (d) => goTo(d.id),
                  })
                }
              >
                <Copy /> {t("copy")}
              </DropdownMenuItem>
              {isDraft && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() =>
                      confirm(t("deleteDraftConfirm")) &&
                      run(() => deleteSalesInvoice(companyId, { id: invoice.id }), {
                        success: t("draftDeleted"),
                        refresh: false,
                        onSuccess: () => router.push(closeHref),
                      })
                    }
                  >
                    <Trash2 /> {t("deleteDraft")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-1 border-b px-5 py-3 text-sm sm:grid-cols-2">
        <Meta label={t("date")} value={fmt(invoice.date)} />
        {invoice.type !== "CREDIT" && <Meta label={t("dueDate")} value={fmt(invoice.dueDate)} />}
        {invoice.referenceNumber && invoice.type !== "CREDIT" && <Meta label={t("referenceNumber")} value={invoice.referenceNumber} mono />}
        {invoice.customerRegCode && <Meta label={t("regCode")} value={invoice.customerRegCode} />}
        {invoice.currencyRate && <Meta label={t("currencyRate")} value={`1 EUR = ${invoice.currencyRate} ${invoice.currency}`} />}
        {invoice.creditOf && (
          <Meta
            label={t("creditOfLabel")}
            value={
              <Link className="font-mono text-primary hover:underline" href={`${base}?doc=${invoice.creditOf.id}`} scroll={false}>
                {invoice.creditOf.number}
              </Link>
            }
          />
        )}
        {invoice.credits.length > 0 && (
          <Meta
            label={t("creditsLabel")}
            value={
              <span className="flex flex-wrap gap-2">
                {invoice.credits.map((c) => (
                  <Link key={c.id} className="font-mono text-primary hover:underline" href={`${base}?doc=${c.id}`} scroll={false}>
                    {c.number ?? t("draftNumber")}
                  </Link>
                ))}
              </span>
            }
          />
        )}
        {invoice.quote && (
          <Meta
            label={t("fromQuote")}
            value={
              <Link className="font-mono text-primary hover:underline" href={`/c/${companyId}/sales/quotes?doc=${invoice.quote.id}`}>
                {invoice.quote.number}
              </Link>
            }
          />
        )}
        {invoice.journal && canViewLedger && (
          <Meta
            label={t("journalEntry")}
            value={
              <Link className="inline-flex items-center gap-1 font-mono text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${invoice.journal.id}`}>
                <BookOpen className="size-3.5" /> {invoice.journal.number}
              </Link>
            }
          />
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">{t("description")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("quantity")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("price")}</th>
              <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">{t("vat")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoice.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-5 py-1.5">{l.description}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {qty(l.quantity)} {l.unit}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {price(l.unitPrice)}
                  {!dec(l.discountPct).isZero() && <span className="block text-xs text-muted-foreground">−{qty(l.discountPct)}%</span>}
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
          <dt className="text-muted-foreground">{t("net")}</dt>
          <dd className="tabular-nums">{money(invoice.netTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("vatTotal")}</dt>
          <dd className="tabular-nums">{money(invoice.vatTotal)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{t("total")}</dt>
          <dd className="tabular-nums">
            {money(invoice.total)} {invoice.currency}
          </dd>
        </div>
        {invoice.currencyRate && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <dt>{t("totalBase")}</dt>
            <dd className="tabular-nums">{money(invoice.totalBase)} EUR</dd>
          </div>
        )}
      </dl>
      {invoice.notes && <p className="border-t px-5 py-3 text-sm whitespace-pre-line text-muted-foreground">{invoice.notes}</p>}

      {(invoice.emails.length > 0 || invoice.confirmedBy) && (
        <div className="space-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
          {invoice.confirmedBy && invoice.confirmedAt && (
            <p>{t("confirmedBy", { name: invoice.confirmedBy, date: formatDate(new Date(invoice.confirmedAt), locale) })}</p>
          )}
          {invoice.emails.map((e) => (
            <p key={e.id} className={e.status === "FAILED" ? "text-destructive" : undefined}>
              {e.status === "SENT" ? t("emailSent", { to: e.to, date: formatDate(new Date(e.createdAt), locale) }) : t("emailFailed", { to: e.to })}
            </p>
          ))}
        </div>
      )}

      {dateAction && (
        <DateActionDialog
          title={dateAction === "credit" ? t("createCredit") : t("createTaxFree")}
          body={dateAction === "credit" ? t("creditBody") : t("taxFreeBody")}
          today={today}
          pending={pending}
          onClose={() => setDateAction(null)}
          onConfirm={(date) =>
            run(
              () =>
                dateAction === "credit"
                  ? creditSalesInvoice(companyId, { id: invoice.id, date })
                  : taxFreeSalesInvoice(companyId, { id: invoice.id, date }),
              { refresh: false, onSuccess: (d) => goTo(d.id) },
            )
          }
        />
      )}
      {sendOpen && invoice.email && (
        <SendDocumentDialog
          title={t("sendTitle", { number: invoice.number ?? "" })}
          initial={invoice.email}
          attachment={`${invoice.number}.pdf`}
          pdfHref={pdfHref}
          onClose={() => setSendOpen(false)}
          send={(values) => sendSalesInvoice(companyId, { id: invoice.id, ...values })}
        />
      )}
    </Card>
  );
}

function Meta({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <span className="text-muted-foreground sm:block sm:text-xs">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}

function DateActionDialog({
  title,
  body,
  today,
  pending,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  today: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
}) {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const [date, setDate] = useState(today);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(date);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">{body}</p>
            <FormField label={t("date")} htmlFor="action-date">
              <Input id="action-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !date}>
              {t("createDraft")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
