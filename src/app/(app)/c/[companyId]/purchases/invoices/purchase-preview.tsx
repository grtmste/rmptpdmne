"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, CheckCircle2, FileMinus2, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { AttachmentsPanel, type AttachmentInfo } from "@/components/common/attachments-panel";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { confirmPurchaseInvoiceById, creditPurchaseInvoice, deletePurchaseInvoice } from "@/server/actions/purchases";

export type PurchasePreviewData = {
  id: string;
  status: "DRAFT" | "CONFIRMED";
  isCredit: boolean;
  number: string | null;
  invoiceNumber: string | null;
  supplierId: string | null;
  supplierName: string;
  date: string;
  dueDate: string;
  referenceNumber: string | null;
  bankAccount: string | null;
  currency: string;
  netTotal: string;
  vatTotal: string;
  total: string;
  notes: string | null;
  creditOf: { id: string; number: string | null } | null;
  credits: Array<{ id: string; number: string | null }>;
  journal: { id: string; number: string | null } | null;
  order: { id: string; number: string } | null;
  lines: Array<{ id: string; description: string; account: string; vat: string; netAmount: string; vatAmount: string }>;
  attachments: AttachmentInfo[];
};

export function PurchasePreview({
  companyId,
  invoice,
  closeHref,
  canEdit,
  canConfirm,
  canViewLedger,
  today,
}: {
  companyId: string;
  invoice: PurchasePreviewData;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  canViewLedger: boolean;
  today: string;
}) {
  const t = useTranslations("purchases");
  const ti = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditDate, setCreditDate] = useState(today);
  const base = `/c/${companyId}/purchases/invoices`;
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);
  const money = (v: string) => formatMoney(v, locale);
  const isDraft = invoice.status === "DRAFT";

  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{invoice.number ?? ti("draftNumber")}</h2>
            <Badge variant={isDraft ? "warning" : "success"}>{isDraft ? ti("statusDraft") : ti("statusConfirmed")}</Badge>
            {invoice.isCredit && <Badge variant="outline">{ti("types.CREDIT")}</Badge>}
          </div>
          <p className="text-sm">
            {invoice.supplierId ? (
              <Link className="font-medium hover:underline" href={`/c/${companyId}/purchases/suppliers/${invoice.supplierId}`}>
                {invoice.supplierName}
              </Link>
            ) : (
              <span className="text-muted-foreground">{t("noSupplierYet")}</span>
            )}
            {invoice.invoiceNumber && <span className="text-muted-foreground"> · {t("supplierNo", { number: invoice.invoiceNumber })}</span>}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 border-b px-5 py-3">
        {isDraft && canEdit && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`${base}/${invoice.id}/edit`}>
              <Pencil /> {ti("edit")}
            </Link>
          </Button>
        )}
        {isDraft && canConfirm && (
          <Button size="sm" disabled={pending} onClick={() => run(() => confirmPurchaseInvoiceById(companyId, { id: invoice.id }), { success: t("confirmed") })}>
            <CheckCircle2 /> {ti("confirm")}
          </Button>
        )}
        {canEdit && (!isDraft ? !invoice.isCredit : true) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={ti("moreActions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isDraft && !invoice.isCredit && (
                <DropdownMenuItem onSelect={() => setCreditOpen(true)}>
                  <FileMinus2 /> {t("createCredit")}
                </DropdownMenuItem>
              )}
              {isDraft && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() =>
                      confirm(ti("deleteDraftConfirm")) &&
                      run(() => deletePurchaseInvoice(companyId, { id: invoice.id }), { success: ti("draftDeleted"), refresh: false, onSuccess: () => router.push(closeHref) })
                    }
                  >
                    <Trash2 /> {ti("deleteDraft")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-1 border-b px-5 py-3 text-sm sm:grid-cols-2">
        <Meta label={ti("date")} value={fmt(invoice.date)} />
        {!invoice.isCredit && <Meta label={ti("dueDate")} value={fmt(invoice.dueDate)} />}
        {invoice.referenceNumber && <Meta label={ti("referenceNumber")} value={invoice.referenceNumber} />}
        {invoice.bankAccount && <Meta label={t("bankAccount")} value={invoice.bankAccount} />}
        {invoice.creditOf && (
          <Meta
            label={t("creditOf")}
            value={
              <Link className="font-mono text-primary hover:underline" href={`${base}?doc=${invoice.creditOf.id}`} scroll={false}>
                {invoice.creditOf.number}
              </Link>
            }
          />
        )}
        {invoice.credits.length > 0 && (
          <Meta
            label={ti("creditsLabel")}
            value={invoice.credits.map((c) => (
              <Link key={c.id} className="mr-2 font-mono text-primary hover:underline" href={`${base}?doc=${c.id}`} scroll={false}>
                {c.number ?? ti("draftNumber")}
              </Link>
            ))}
          />
        )}
        {invoice.order && (
          <Meta
            label={t("fromOrder")}
            value={
              <Link className="font-mono text-primary hover:underline" href={`/c/${companyId}/purchases/orders?doc=${invoice.order.id}`}>
                {invoice.order.number}
              </Link>
            }
          />
        )}
        {invoice.journal && canViewLedger && (
          <Meta
            label={ti("journalEntry")}
            value={
              <Link className="inline-flex items-center gap-1 font-mono text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${invoice.journal.id}`}>
                <BookOpen className="size-3.5" /> {invoice.journal.number}
              </Link>
            }
          />
        )}
      </dl>

      {invoice.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">{ti("description")}</th>
                <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">{ti("account")}</th>
                <th className="px-2 py-2 text-right font-medium">{ti("vat")}</th>
                <th className="px-5 py-2 text-right font-medium">{ti("amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-1.5">{l.description}</td>
                  <td className="hidden px-2 py-1.5 text-xs text-muted-foreground sm:table-cell">{l.account}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {money(l.vatAmount)}
                    <span className="block text-[11px] text-muted-foreground">{l.vat}</span>
                  </td>
                  <td className="px-5 py-1.5 text-right tabular-nums">{money(l.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="space-y-1 border-t px-5 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("net")}</dt>
          <dd className="tabular-nums">{money(invoice.netTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("vatTotal")}</dt>
          <dd className="tabular-nums">{money(invoice.vatTotal)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{ti("total")}</dt>
          <dd className="tabular-nums">
            {money(invoice.total)} {invoice.currency}
          </dd>
        </div>
      </dl>
      {invoice.notes && <p className="border-t px-5 py-3 text-sm whitespace-pre-line text-muted-foreground">{invoice.notes}</p>}
      <div className="border-t px-5 py-4">
        <AttachmentsPanel
          companyId={companyId}
          documentType="PurchaseInvoice"
          documentId={invoice.id}
          attachments={invoice.attachments}
          canEdit={canEdit}
          locked={!isDraft}
        />
      </div>

      {creditOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreditOpen(false)}>
          <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => creditPurchaseInvoice(companyId, { id: invoice.id, date: creditDate }), {
                  refresh: false,
                  onSuccess: (d) => router.push(`${base}/${d.id}/edit`),
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("createCredit")}</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("creditBody")}</p>
                <FormField label={ti("date")} htmlFor="pcredit-date">
                  <Input id="pcredit-date" type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreditOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {ti("createDraft")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-muted-foreground sm:text-xs">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
