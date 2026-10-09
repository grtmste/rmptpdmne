"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useActionRunner } from "@/components/common/use-action";
import { sendStatementsAction } from "@/server/actions/collections";

export type ReminderRow = {
  customerId: string;
  customerName: string;
  email: string | null;
  documents: number;
  total: string;
  maxOverdueDays: number;
  lastSentAt: string | null;
};

export function ReminderSender({
  companyId,
  kind,
  asOf,
  days,
  rows,
  canSend,
}: {
  companyId: string;
  kind: "REMINDER" | "STATEMENT";
  asOf: string;
  days: number;
  rows: ReminderRow[];
  canSend: boolean;
}) {
  const t = useTranslations("reminders");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const withEmail = rows.filter((r) => r.email).map((r) => r.customerId);
  const [selected, setSelected] = useState<string[]>(withEmail);
  const pdfHref = (id: string) => `/c/${companyId}/sales/reminders/pdf?${new URLSearchParams({ kind, to: asOf, days: String(days), customer: id })}`;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="reminder-table">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label={t("selectAll")}
                    checked={selected.length > 0 && selected.length === withEmail.length}
                    onChange={(e) => setSelected(e.target.checked ? withEmail : [])}
                    className="size-4 accent-[var(--primary)]"
                  />
                </th>
                <th className="px-2 py-2 text-left font-medium">{t("customer")}</th>
                <th className="px-2 py-2 text-left font-medium">{t("email")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("documents")}</th>
                {kind === "REMINDER" && <th className="px-2 py-2 text-right font-medium">{t("maxOverdue")}</th>}
                <th className="px-2 py-2 text-right font-medium">{kind === "REMINDER" ? t("overdueTotal") : t("balance")}</th>
                <th className="px-2 py-2 text-left font-medium">{t("lastSent")}</th>
                <th className="w-12 px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.customerId} className="hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={t("selectCustomer", { name: r.customerName })}
                      disabled={!r.email}
                      checked={selected.includes(r.customerId)}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, r.customerId] : selected.filter((x) => x !== r.customerId))}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </td>
                  <td className="px-2 py-2 font-medium">{r.customerName}</td>
                  <td className="px-2 py-2 text-muted-foreground">{r.email ?? <Badge variant="warning">{t("noEmail")}</Badge>}</td>
                  <td className="num px-2 py-2">{r.documents}</td>
                  {kind === "REMINDER" && <td className="num px-2 py-2">{t("days", { days: r.maxOverdueDays })}</td>}
                  <td className="num px-2 py-2 font-semibold">{formatMoney(r.total, locale)}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{r.lastSentAt ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="icon-sm" variant="ghost" asChild aria-label={t("preview", { name: r.customerName })} title={t("pdf")}>
                      <a href={pdfHref(r.customerId)} target="_blank" rel="noreferrer">
                        <FileText />
                      </a>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {canSend && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="mr-auto text-sm text-muted-foreground">{t("selectedCount", { count: selected.length })}</span>
          <Button
            disabled={pending || selected.length === 0}
            onClick={() =>
              confirm(t(kind === "REMINDER" ? "sendConfirmReminder" : "sendConfirmStatement", { count: selected.length })) &&
              run(() => sendStatementsAction(companyId, { kind, asOf, minOverdueDays: days, customerIds: selected }), {
                onSuccess: (d) => {
                  if (d.failed || d.noEmail) toast.warning(t("sentPartly", d));
                  else toast.success(t("sent", { count: d.sent }));
                },
              })
            }
          >
            <Send /> {kind === "REMINDER" ? t("sendReminders") : t("sendStatements")}
          </Button>
        </div>
      )}
    </div>
  );
}
