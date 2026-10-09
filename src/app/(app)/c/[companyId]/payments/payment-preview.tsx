"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, CheckCircle2, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatIban } from "@/lib/iban";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { cancelPaymentAction, confirmPaymentById, deletePaymentAction } from "@/server/actions/payments";

export type PaymentPreviewData = {
  id: string;
  number: string | null;
  status: "DRAFT" | "CONFIRMED";
  cancelled: boolean;
  direction: "IN" | "OUT" | "NETTING";
  bankAccount: string | null;
  date: string;
  amount: string;
  currency: string;
  partyName: string;
  partyIban: string | null;
  referenceNumber: string | null;
  description: string | null;
  journal: { id: string; number: string | null } | null;
  allocations: Array<{ id: string; type: string; label: string; href: string | null; amount: string; description: string | null }>;
};

export function PaymentPreview({
  companyId,
  payment,
  closeHref,
  canEdit,
  canConfirm,
  canViewLedger,
  today,
}: {
  companyId: string;
  payment: PaymentPreviewData;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  canViewLedger: boolean;
  today: string;
}) {
  const t = useTranslations("payments");
  const ti = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState(today);
  const isDraft = payment.status === "DRAFT";
  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{payment.number ?? ti("draftNumber")}</h2>
            <Badge variant={isDraft ? "warning" : payment.cancelled ? "destructive" : "success"}>
              {isDraft ? ti("statusDraft") : payment.cancelled ? t("cancelled") : ti("statusConfirmed")}
            </Badge>
            <Badge variant="outline">{t(`directions.${payment.direction}`)}</Badge>
          </div>
          <p className="text-sm">
            <span className="font-medium">{payment.partyName || "—"}</span>
            <span className="text-muted-foreground"> · {formatDate(parseISODate(payment.date)!, locale)}</span>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        {isDraft && canEdit && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/c/${companyId}/payments/${payment.id}/edit`}>
              <Pencil /> {ti("edit")}
            </Link>
          </Button>
        )}
        {isDraft && canConfirm && (
          <Button size="sm" disabled={pending} onClick={() => run(() => confirmPaymentById(companyId, { id: payment.id }), { success: t("confirmed") })}>
            <CheckCircle2 /> {ti("confirm")}
          </Button>
        )}
        {isDraft && canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() =>
              confirm(ti("deleteDraftConfirm")) &&
              run(() => deletePaymentAction(companyId, { id: payment.id }), { success: ti("draftDeleted"), refresh: false, onSuccess: () => router.push(closeHref) })
            }
          >
            <Trash2 /> {ti("deleteDraft")}
          </Button>
        )}
        {!isDraft && !payment.cancelled && canConfirm && (
          <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
            <RotateCcw /> {t("cancel")}
          </Button>
        )}
        {payment.journal && canViewLedger && (
          <Link className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${payment.journal.id}`}>
            <BookOpen className="size-3.5" /> {payment.journal.number}
          </Link>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-1 border-b px-5 py-3 text-sm sm:grid-cols-2">
        {payment.bankAccount && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("account")}</dt>
            <dd>{payment.bankAccount}</dd>
          </div>
        )}
        {payment.direction !== "NETTING" && (
          <div>
            <dt className="text-xs text-muted-foreground">{t("amount")}</dt>
            <dd className="font-semibold tabular-nums">
              {formatMoney(payment.amount, locale)} {payment.currency}
            </dd>
          </div>
        )}
        {payment.partyIban && (
          <div>
            <dt className="text-xs text-muted-foreground">IBAN</dt>
            <dd className="font-mono text-xs">{formatIban(payment.partyIban)}</dd>
          </div>
        )}
        {payment.referenceNumber && (
          <div>
            <dt className="text-xs text-muted-foreground">{ti("referenceNumber")}</dt>
            <dd>{payment.referenceNumber}</dd>
          </div>
        )}
        {payment.description && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("description")}</dt>
            <dd>{payment.description}</dd>
          </div>
        )}
      </dl>
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left font-medium">{t("allocation")}</th>
            <th className="px-5 py-2 text-right font-medium">{t("amount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {payment.allocations.map((a) => (
            <tr key={a.id}>
              <td className="px-5 py-1.5">
                <span className="text-xs text-muted-foreground">{t(`allocationTypes.${a.type}`)}</span>{" "}
                {a.href ? (
                  <Link className="font-mono text-primary hover:underline" href={a.href}>
                    {a.label}
                  </Link>
                ) : (
                  <span>{a.label}</span>
                )}
                {a.description && <span className="block text-xs text-muted-foreground">{a.description}</span>}
              </td>
              <td className="px-5 py-1.5 text-right tabular-nums">{formatMoney(a.amount, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cancelOpen && (
        <Dialog open onOpenChange={(o) => !o && setCancelOpen(false)}>
          <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => cancelPaymentAction(companyId, { id: payment.id, date: cancelDate }), { success: t("cancelledToast"), onSuccess: () => setCancelOpen(false) });
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("cancelTitle")}</DialogTitle>
              </DialogHeader>
              <DialogBody className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("cancelBody")}</p>
                <FormField label={ti("date")} htmlFor="cancel-date">
                  <Input id="cancel-date" type="date" value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {t("cancel")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
