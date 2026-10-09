"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQuantity } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useActionRunner } from "@/components/common/use-action";
import { confirmMovementById, deleteMovementAction } from "@/server/actions/inventory";

export type MovementPreviewData = {
  id: string;
  number: string | null;
  status: "DRAFT" | "CONFIRMED";
  type: "RECEIPT" | "ISSUE" | "TRANSFER" | "COUNT" | "SALE" | "PURCHASE";
  date: string;
  warehouse: string;
  toWarehouse: string | null;
  counterAccount: string | null;
  description: string | null;
  totalCost: string;
  source: { label: string; href: string } | null;
  journal: { id: string; number: string | null } | null;
  lines: Array<{ id: string; code: string; name: string; unit: string | null; quantity: string; counted: string | null; unitCost: string; totalCost: string }>;
};

export function MovementPreview({
  companyId,
  movement: m,
  closeHref,
  canEdit,
  canConfirm,
  canViewLedger,
}: {
  companyId: string;
  movement: MovementPreviewData;
  closeHref: string;
  canEdit: boolean;
  canConfirm: boolean;
  canViewLedger: boolean;
}) {
  const t = useTranslations("inventory");
  const ti = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const isDraft = m.status === "DRAFT";
  const manual = m.type !== "SALE" && m.type !== "PURCHASE";
  return (
    <Card className="self-start lg:sticky lg:top-20">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">{m.number ?? ti("draftNumber")}</h2>
            <Badge variant={isDraft ? "warning" : "success"}>{isDraft ? ti("statusDraft") : ti("statusConfirmed")}</Badge>
            <Badge variant="outline">{t(`types.${m.type}`)}</Badge>
          </div>
          <p className="text-sm">
            <span className="font-medium">
              {m.warehouse}
              {m.toWarehouse ? ` → ${m.toWarehouse}` : ""}
            </span>
            <span className="text-muted-foreground"> · {formatDate(parseISODate(m.date)!, locale)}</span>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={closeHref} scroll={false} aria-label={ti("closePreview")}>
            <X />
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        {isDraft && manual && canEdit && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/c/${companyId}/inventory/movements/${m.id}/edit`}>
              <Pencil /> {ti("edit")}
            </Link>
          </Button>
        )}
        {isDraft && canConfirm && (
          <Button size="sm" disabled={pending} onClick={() => run(() => confirmMovementById(companyId, { id: m.id }), { success: t("movementConfirmed") })}>
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
              confirm(t("deleteDraftConfirm")) &&
              run(() => deleteMovementAction(companyId, { id: m.id }), { success: ti("draftDeleted"), refresh: false, onSuccess: () => router.push(closeHref) })
            }
          >
            <Trash2 /> {ti("deleteDraft")}
          </Button>
        )}
        {m.source && (
          <Link className="text-sm text-primary hover:underline" href={m.source.href}>
            {m.source.label}
          </Link>
        )}
        {m.journal && canViewLedger && (
          <Link className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/c/${companyId}/finance/journal?entry=${m.journal.id}`}>
            <BookOpen className="size-3.5" /> {m.journal.number}
          </Link>
        )}
      </div>
      {(m.counterAccount || m.description) && (
        <dl className="grid gap-x-6 gap-y-1 border-b px-5 py-3 text-sm sm:grid-cols-2">
          {m.counterAccount && (
            <div>
              <dt className="text-xs text-muted-foreground">{t("counterAccount")}</dt>
              <dd>{m.counterAccount}</dd>
            </div>
          )}
          {m.description && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t("description")}</dt>
              <dd>{m.description}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">{t("item")}</th>
              {m.type === "COUNT" && <th className="px-3 py-2 text-right font-medium">{t("counted")}</th>}
              <th className="px-3 py-2 text-right font-medium">{m.type === "COUNT" ? t("difference") : t("quantity")}</th>
              {m.type !== "TRANSFER" && <th className="px-3 py-2 text-right font-medium">{t("unitCost")}</th>}
              {m.type !== "TRANSFER" && <th className="px-5 py-2 text-right font-medium">{t("value")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {m.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-5 py-1.5">
                  <span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}
                </td>
                {m.type === "COUNT" && (
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatQuantity(l.counted ?? "0", locale)} {l.unit}
                  </td>
                )}
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {isDraft && m.type === "COUNT" ? "—" : `${formatQuantity(l.quantity, locale)} ${m.type === "COUNT" ? "" : (l.unit ?? "")}`}
                </td>
                {m.type !== "TRANSFER" && (
                  <td className="px-3 py-1.5 text-right tabular-nums">{isDraft && l.unitCost === "0" ? "—" : formatMoney(l.unitCost, locale, { scale: 4 })}</td>
                )}
                {m.type !== "TRANSFER" && <td className="px-5 py-1.5 text-right tabular-nums">{isDraft && l.totalCost === "0.00" ? "—" : formatMoney(l.totalCost, locale)}</td>}
              </tr>
            ))}
          </tbody>
          {m.type !== "TRANSFER" && !isDraft && (
            <tfoot className="border-t font-semibold">
              <tr>
                <td className="px-5 py-2" colSpan={m.type === "COUNT" ? 4 : 3}>
                  {t("valueChange")}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">{formatMoney(m.totalCost, locale)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
