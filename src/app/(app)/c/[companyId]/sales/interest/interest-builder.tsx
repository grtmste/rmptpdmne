"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Percent } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActionRunner } from "@/components/common/use-action";
import { createInterestInvoicesAction } from "@/server/actions/collections";

export type InterestCustomer = {
  customerId: string;
  customerName: string;
  total: string;
  rows: Array<{ invoiceId: string; number: string; dueDate: string; from: string; to: string; days: number; ratePct: string; open: string; amount: string; currency: string }>;
};

export function InterestBuilder({ companyId, asOf, customers, canConfirm }: { companyId: string; asOf: string; customers: InterestCustomer[]; canConfirm: boolean }) {
  const t = useTranslations("interest");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [selected, setSelected] = useState<string[]>(customers.map((c) => c.customerId));
  const [date, setDate] = useState(asOf);
  const [confirmNow, setConfirmNow] = useState(false);
  const m = (v: string) => formatMoney(v, locale);
  const all = selected.length === customers.length;
  const total = customers.filter((c) => selected.includes(c.customerId)).reduce((s, c) => s + Number(c.total), 0);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="interest-table">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label={t("selectAll")}
                    checked={all}
                    onChange={(e) => setSelected(e.target.checked ? customers.map((c) => c.customerId) : [])}
                    className="size-4 accent-[var(--primary)]"
                  />
                </th>
                <th className="px-2 py-2 text-left font-medium">{t("invoice")}</th>
                <th className="px-2 py-2 text-left font-medium">{t("period")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("days")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("rate")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("open")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("interest")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <Fragment key={c.customerId}>
                  <tr className="border-t bg-muted/20 font-medium">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={t("selectCustomer", { name: c.customerName })}
                        checked={selected.includes(c.customerId)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, c.customerId] : selected.filter((x) => x !== c.customerId))}
                        className="size-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td colSpan={5} className="px-2 py-2">
                      {c.customerName}
                    </td>
                    <td className="num px-4 py-2">{m(c.total)}</td>
                  </tr>
                  {c.rows.map((r) => (
                    <tr key={r.invoiceId} className="text-muted-foreground">
                      <td />
                      <td className="px-2 py-1 font-mono text-xs">{r.number}</td>
                      <td className="px-2 py-1 text-xs">
                        {r.from} – {r.to}
                        {r.currency !== "EUR" && <span className="ml-1 text-warning">({t("notEur")})</span>}
                      </td>
                      <td className="num px-2 py-1">{r.days}</td>
                      <td className="num px-2 py-1">{r.ratePct}%</td>
                      <td className="num px-2 py-1">{m(r.open)}</td>
                      <td className="num px-4 py-1">{m(r.amount)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="int-date">{t("invoiceDate")}</Label>
          <Input id="int-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </div>
        {canConfirm && <Checkbox label={t("confirmNow")} checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} className="pb-2" />}
        <span className="ml-auto text-sm">
          {t("selected", { count: selected.length })}: <b className="tabular-nums">{formatMoney(total, locale)}</b>
        </span>
        <Button
          disabled={pending || selected.length === 0}
          onClick={() =>
            run(() => createInterestInvoicesAction(companyId, { asOf, date, customerIds: selected, confirm: confirmNow }), {
              refresh: false,
              success: t("created"),
              onSuccess: (d) => router.push(`/c/${companyId}/sales/invoices?doc=${d.ids[0]}`),
            })
          }
        >
          <Percent /> {t("create")}
        </Button>
      </div>
    </div>
  );
}
