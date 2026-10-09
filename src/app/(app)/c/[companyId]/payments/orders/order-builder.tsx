"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Download, FileOutput, Trash2 } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { createPaymentOrderAction, deletePaymentOrder, markPaymentOrderPaidAction } from "@/server/actions/payments";

export type PayableRow = {
  type: "PURCHASE_INVOICE" | "EXPENSE_REPORT";
  id: string;
  number: string;
  invoiceNumber: string | null;
  partyName: string;
  dueDate: string | null;
  open: string;
  currency: string;
  iban: string | null;
};

export function OrderBuilder({
  companyId,
  rows,
  banks,
  canConfirm,
  defaultDate,
}: {
  companyId: string;
  rows: PayableRow[];
  banks: Array<{ id: string; name: string }>;
  canConfirm: boolean;
  defaultDate: string;
}) {
  const t = useTranslations("paymentOrders");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const total = sum(Object.values(picked).map((v) => dec(v || 0)));
  const payable = rows.filter((r) => r.iban && r.currency === "EUR");
  const allPicked = payable.length > 0 && payable.every((r) => r.id in picked);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  label={<span className="sr-only">{t("selectAll")}</span>}
                  checked={allPicked}
                  onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(payable.map((r) => [r.id, r.open])) : {})}
                />
              </th>
              <th className="px-2 py-2 text-left font-medium">{t("document")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("payee")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("dueDate")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("open")}</th>
              <th className="w-32 px-4 py-2 text-right font-medium">{t("payAmount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  {t("nothingToPay")}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const disabled = !r.iban || r.currency !== "EUR";
                const overdue = r.dueDate && r.dueDate < defaultDate;
                return (
                  <tr key={r.id} className={cn(r.id in picked && "bg-accent/40", disabled && "opacity-60")}>
                    <td className="px-3 py-1.5">
                      <Checkbox
                        label={<span className="sr-only">{r.number}</span>}
                        disabled={disabled}
                        checked={r.id in picked}
                        onChange={(e) =>
                          setPicked((p) => {
                            const next = { ...p };
                            if (e.target.checked) next[r.id] = r.open;
                            else delete next[r.id];
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="font-mono">{r.number}</span>
                      {r.invoiceNumber && <span className="ml-1.5 text-xs text-muted-foreground">{r.invoiceNumber}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.partyName}
                      <div className="font-mono text-xs text-muted-foreground">{r.iban ?? t("noIban")}</div>
                    </td>
                    <td className={cn("px-2 py-1.5 tabular-nums", overdue ? "text-warning" : "text-muted-foreground")}>{r.dueDate ? formatDate(parseISODate(r.dueDate)!, locale) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatMoney(r.open, locale)}
                      {r.currency !== "EUR" && <span className="ml-1 text-xs">{r.currency}</span>}
                    </td>
                    <td className="px-4 py-1">
                      {r.id in picked && (
                        <Input className="h-8 text-right tabular-nums" aria-label={`${t("payAmount")} ${r.number}`} value={picked[r.id]} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.value })} />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {canConfirm && (
        <CardContent className="flex flex-wrap items-end gap-3 border-t pt-4">
          <FormField label={t("fromAccount")} htmlFor="po-bank" className="min-w-48">
            <NativeSelect id="po-bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("executionDate")} htmlFor="po-date">
            <Input id="po-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <span className="ml-auto text-sm">
            {t("selected", { count: Object.keys(picked).length })}: <b className="tabular-nums">{formatMoney(total, locale)}</b>
          </span>
          <Button
            disabled={pending || Object.keys(picked).length === 0 || !bankId}
            onClick={() =>
              run(
                () =>
                  createPaymentOrderAction(companyId, {
                    bankAccountId: bankId,
                    executionDate: date,
                    items: Object.entries(picked).map(([id, amount]) => ({ type: rows.find((r) => r.id === id)!.type, id, amount })),
                  }),
                {
                  success: t("created"),
                  onSuccess: (d) => {
                    setPicked({});
                    // Faili allalaadimine (mitte lehe vahetus)
                    window.open(`/c/${companyId}/payments/orders/${d.id}/xml`, "_blank");
                  },
                },
              )
            }
          >
            <FileOutput /> {t("create")}
          </Button>
          {banks.length === 0 && <p className="w-full text-xs text-warning">{t("noBankIban")}</p>}
        </CardContent>
      )}
    </Card>
  );
}

export function OrderActions({ companyId, orderId, paid, canConfirm }: { companyId: string; orderId: string; paid: boolean; canConfirm: boolean }) {
  const t = useTranslations("paymentOrders");
  const { pending, run } = useActionRunner();
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" asChild>
        <a href={`/c/${companyId}/payments/orders/${orderId}/xml`}>
          <Download /> XML
        </a>
      </Button>
      {!paid && canConfirm && (
        <>
          <Button size="sm" disabled={pending} onClick={() => confirm(t("markPaidConfirm")) && run(() => markPaymentOrderPaidAction(companyId, { id: orderId }), { success: t("markedPaid") })}>
            <CheckCircle2 /> {t("markPaid")}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t("delete")} disabled={pending} onClick={() => confirm(t("deleteConfirm")) && run(() => deletePaymentOrder(companyId, { id: orderId }))}>
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  );
}
