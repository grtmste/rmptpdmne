"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Copy, Pencil, Printer, RotateCcw, Send, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { copyJournal, deleteJournalDraft, postJournalDraft, reverseJournal } from "@/server/actions/journal";

export type PreviewEntry = {
  id: string;
  number: string | null;
  status: "DRAFT" | "POSTED";
  source: string;
  sourceId: string | null;
  date: string;
  description: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
  reversalOf: { id: string; number: string | null } | null;
  reversedBy: { id: string; number: string | null } | null;
  lines: Array<{
    id: string;
    account: string;
    description: string | null;
    debit: string;
    credit: string;
    department: string | null;
    vat: string | null;
    dimensions: string[];
  }>;
};

export function EntryPreview({
  companyId,
  entry,
  closeHref,
  canEdit,
  canConfirm,
  today,
}: {
  companyId: string;
  entry: PreviewEntry;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  today: string;
}) {
  const t = useTranslations("journal");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [reverseOpen, setReverseOpen] = useState(false);
  const base = `/c/${companyId}/finance/journal`;
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);
  const totalDebit = entry.lines.reduce((s, l) => s.plus(l.debit), dec(0));
  const totalCredit = entry.lines.reduce((s, l) => s.plus(l.credit), dec(0));
  const isDraft = entry.status === "DRAFT";
  const canReverse = !isDraft && entry.source === "MANUAL" && !entry.reversalOf && !entry.reversedBy;

  return (
    <Card className="self-start lg:sticky lg:top-20 print:border-0 print:shadow-none">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{entry.number ?? t("draftNumber")}</h2>
            <Badge variant={isDraft ? "warning" : "success"}>{isDraft ? t("statusDraft") : t("statusPosted")}</Badge>
            <Badge variant="outline">{t(`sources.${entry.source}`)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {fmt(entry.date)}
            {entry.description ? ` · ${entry.description}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild className="print:hidden">
          <Link href={closeHref} scroll={false} aria-label={t("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>

      {entry.source === "SALES_INVOICE" && entry.sourceId && (
        <div className="border-b bg-muted/40 px-5 py-2 text-sm">
          <Link className="text-primary hover:underline" href={`/c/${companyId}/sales/invoices?doc=${entry.sourceId}`}>
            {t("openDocument")}
          </Link>
        </div>
      )}

      {(entry.reversalOf || entry.reversedBy) && (
        <div className="border-b bg-muted/40 px-5 py-2 text-sm">
          {entry.reversalOf && (
            <>
              {t("reversalOfLabel")}{" "}
              <Link className="font-mono text-primary hover:underline" href={`${base}?entry=${entry.reversalOf.id}`} scroll={false}>
                {entry.reversalOf.number}
              </Link>
            </>
          )}
          {entry.reversedBy && (
            <>
              {t("reversedByLabel")}{" "}
              <Link className="font-mono text-primary hover:underline" href={`${base}?entry=${entry.reversedBy.id}`} scroll={false}>
                {entry.reversedBy.number}
              </Link>
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">{t("account")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("debit")}</th>
              <th className="px-5 py-2 text-right font-medium">{t("credit")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entry.lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="px-5 py-2">
                  <div>{l.account}</div>
                  {(l.description || l.department || l.vat || l.dimensions.length > 0) && (
                    <div className="mt-0.5 space-x-2 text-xs text-muted-foreground">
                      {l.description && <span>{l.description}</span>}
                      {l.department && <span>· {t("department")}: {l.department}</span>}
                      {l.dimensions.map((d) => (
                        <span key={d}>· {d}</span>
                      ))}
                      {l.vat && <span>· {l.vat}</span>}
                    </div>
                  )}
                </td>
                <td className="num px-3 py-2">{dec(l.debit).isZero() ? "" : formatMoney(l.debit, locale)}</td>
                <td className="num px-5 py-2">{dec(l.credit).isZero() ? "" : formatMoney(l.credit, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t font-semibold">
            <tr>
              <td className="px-5 py-2">{t("totals")}</td>
              <td className="num px-3 py-2">{formatMoney(totalDebit, locale)}</td>
              <td className="num px-5 py-2">{formatMoney(totalCredit, locale)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-0.5 border-t px-5 py-3 text-xs text-muted-foreground">
        {entry.createdBy && <div>{t("createdBy", { name: entry.createdBy })}</div>}
        {entry.postedBy && entry.postedAt && (
          <div>{t("postedBy", { name: entry.postedBy, date: formatDate(new Date(entry.postedAt), locale) })}</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t px-5 py-3 print:hidden">
        {isDraft && canEdit && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`${base}/${entry.id}/edit`}>
              <Pencil /> {t("edit")}
            </Link>
          </Button>
        )}
        {isDraft && canConfirm && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => postJournalDraft(companyId, { id: entry.id }), { success: t("posted") })}
          >
            <Send /> {t("post")}
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() => copyJournal(companyId, { id: entry.id, date: today }), {
                success: t("copied"),
                refresh: false,
                onSuccess: (d) => router.push(`${base}/${d.id}/edit`),
              })
            }
          >
            <Copy /> {t("copy")}
          </Button>
        )}
        {canReverse && canConfirm && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setReverseOpen(true)}>
            <RotateCcw /> {t("reverse")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => window.print()}>
          <Printer /> {t("print")}
        </Button>
        {isDraft && canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={pending}
            onClick={() => {
              if (confirm(t("deleteDraftConfirm"))) {
                run(() => deleteJournalDraft(companyId, { id: entry.id }), {
                  success: t("draftDeleted"),
                  refresh: false,
                  onSuccess: () => router.push(base),
                });
              }
            }}
          >
            <Trash2 /> {t("deleteDraft")}
          </Button>
        )}
      </div>

      {reverseOpen && (
        <ReverseDialog
          defaultDate={today}
          onClose={() => setReverseOpen(false)}
          onConfirm={(date, setError) =>
            run(() => reverseJournal(companyId, { id: entry.id, date }), {
              success: t("reversedDone"),
              refresh: false,
              onSuccess: (d) => {
                setReverseOpen(false);
                router.push(`${base}?entry=${d.id}`);
              },
              onError: (_res, msg) => setError(msg),
            })
          }
          pending={pending}
        />
      )}
    </Card>
  );
}

function ReverseDialog({
  defaultDate,
  onClose,
  onConfirm,
  pending,
}: {
  defaultDate: string;
  onClose: () => void;
  onConfirm: (date: string, setError: (msg: string) => void) => void;
  pending: boolean;
}) {
  const t = useTranslations("journal");
  const tc = useTranslations("common");
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            onConfirm(date, setError);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("reverseTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("reverseBody")}</p>
            <FormError message={error} />
            <FormField label={t("reverseDate")} htmlFor="reverse-date" className="sm:w-56">
              <Input id="reverse-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("reverse")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
