"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AttachmentsPanel, type AttachmentInfo } from "@/components/common/attachments-panel";
import { useActionRunner } from "@/components/common/use-action";
import { confirmExpenseReportById, deleteExpenseReport } from "@/server/actions/purchases";

export type ExpensePreviewData = {
  id: string;
  status: "DRAFT" | "CONFIRMED";
  number: string | null;
  employeeName: string;
  date: string;
  description: string | null;
  vatTotal: string;
  total: string;
  journal: { id: string; number: string | null } | null;
  attachments: AttachmentInfo[];
  lines: Array<{ id: string; date: string; vendor: string | null; description: string; account: string; grossAmount: string; vatAmount: string }>;
};

export function ExpensePreview({
  companyId,
  report,
  closeHref,
  canEdit,
  canConfirm,
  canViewLedger,
}: {
  companyId: string;
  report: ExpensePreviewData;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  canViewLedger: boolean;
}) {
  const t = useTranslations("expenses");
  const ti = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);
  const isDraft = report.status === "DRAFT";
  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{report.number ?? ti("draftNumber")}</h2>
            <Badge variant={isDraft ? "warning" : "success"}>{isDraft ? ti("statusDraft") : ti("statusConfirmed")}</Badge>
          </div>
          <p className="text-sm">
            <span className="font-medium">{report.employeeName}</span>
            <span className="text-muted-foreground">
              {" "}
              · {fmt(report.date)}
              {report.description ? ` · ${report.description}` : ""}
            </span>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>
      {(isDraft || report.journal) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          {isDraft && canEdit && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/c/${companyId}/purchases/expenses/${report.id}/edit`}>
                <Pencil /> {ti("edit")}
              </Link>
            </Button>
          )}
          {isDraft && canConfirm && (
            <Button size="sm" disabled={pending} onClick={() => run(() => confirmExpenseReportById(companyId, { id: report.id }), { success: t("confirmed") })}>
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
                run(() => deleteExpenseReport(companyId, { id: report.id }), { success: ti("draftDeleted"), refresh: false, onSuccess: () => router.push(closeHref) })
              }
            >
              <Trash2 /> {ti("deleteDraft")}
            </Button>
          )}
          {report.journal && canViewLedger && (
            <Link className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${report.journal.id}`}>
              <BookOpen className="size-3.5" /> {report.journal.number}
            </Link>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2 text-left font-medium">{t("receipt")}</th>
            <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">{ti("account")}</th>
            <th className="px-2 py-2 text-right font-medium">{ti("vatTotal")}</th>
            <th className="px-5 py-2 text-right font-medium">{t("gross")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {report.lines.map((l) => (
            <tr key={l.id}>
              <td className="px-5 py-1.5">
                {l.description}
                <span className="block text-xs text-muted-foreground">
                  {fmt(l.date)}
                  {l.vendor ? ` · ${l.vendor}` : ""}
                </span>
              </td>
              <td className="hidden px-2 py-1.5 text-xs text-muted-foreground sm:table-cell">{l.account}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(l.vatAmount, locale)}</td>
              <td className="px-5 py-1.5 text-right tabular-nums">{formatMoney(l.grossAmount, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="space-y-1 border-t px-5 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{ti("vatTotal")}</dt>
          <dd className="tabular-nums">{formatMoney(report.vatTotal, locale)}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{t("toReimburse")}</dt>
          <dd className="tabular-nums">{formatMoney(report.total, locale)}</dd>
        </div>
      </dl>
      <div className="border-t px-5 py-4">
        <AttachmentsPanel companyId={companyId} documentType="ExpenseReport" documentId={report.id} attachments={report.attachments} canEdit={canEdit} locked={!isDraft} />
      </div>
    </Card>
  );
}
