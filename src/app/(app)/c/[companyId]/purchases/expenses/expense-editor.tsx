"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { resolveVatRate } from "@/lib/accounting/vat";
import { dec, formatMoney, parseMoneyInput, sum } from "@/lib/money";
import { calculatePurchase } from "@/lib/purchases/calc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { confirmExpenseReportAction, saveExpenseReportAction } from "@/server/actions/purchases";
import type { PurchaseEditorData } from "../purchase-editor";

export type ExpenseLine = {
  key: string;
  date: string;
  vendor: string;
  documentNumber: string;
  description: string;
  accountId: string;
  vatRateId: string;
  grossAmount: string;
};

export type ExpenseValues = { employeeId: string; date: string; description: string; lines: ExpenseLine[] };

let seq = 0;
export const newExpenseLine = (patch: Partial<ExpenseLine> = {}): ExpenseLine => ({
  key: `x${Date.now().toString(36)}${(seq++).toString(36)}`,
  date: "",
  vendor: "",
  documentNumber: "",
  description: "",
  accountId: "",
  vatRateId: "",
  grossAmount: "",
  ...patch,
});

const num = (s: string) => (s.trim() === "" ? dec(0) : (parseMoneyInput(s) ?? null));

export function ExpenseEditor({
  companyId,
  reportId,
  initial,
  employees,
  data,
  canConfirm,
  side,
}: {
  companyId: string;
  reportId?: string;
  initial: ExpenseValues;
  employees: Array<{ id: string; name: string }>;
  data: Pick<PurchaseEditorData, "vatRates" | "accounts" | "defaultAccountId" | "defaultVatRateId">;
  canConfirm: boolean;
  side?: React.ReactNode;
}) {
  const t = useTranslations("expenses");
  const ti = useTranslations("invoices");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<ExpenseValues>(() => ({
    ...initial,
    lines: initial.lines.length ? initial.lines : [newExpenseLine({ date: initial.date, vatRateId: data.defaultVatRateId ?? "", accountId: data.defaultAccountId ?? "" })],
  }));
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const gridId = useId();
  const vatById = useMemo(() => new Map(data.vatRates.map((r) => [r.id, r])), [data.vatRates]);
  const accountOptions: ComboOption[] = useMemo(() => data.accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), [data.accounts]);

  // Iga tšekk eraldi: KM eraldatakse brutosummast tšeki kuupäeva määraga
  const results = useMemo(
    () =>
      v.lines.map((l) => {
        const rate = l.vatRateId ? vatById.get(l.vatRateId) : null;
        const date = parseISODate(l.date || v.date);
        const pct =
          rate && date
            ? resolveVatRate(
                rate.periods.map((p) => ({ rate: p.rate, validFrom: parseISODate(p.validFrom)!, validTo: p.validTo ? parseISODate(p.validTo) : null })),
                date,
              )
            : null;
        return calculatePurchase(
          [{ quantity: "1", unitPrice: num(l.grossAmount) ?? dec(0), vatRateId: l.vatRateId || null, vatPct: pct?.toString() ?? "0", vatKind: rate?.kind ?? null, deductiblePct: rate?.deductiblePct ?? "100" }],
          { pricesIncludeVat: true },
        );
      }),
    [v.lines, v.date, vatById],
  );
  const totals = { vat: sum(results.map((r) => r.vat)), total: sum(results.map((r) => r.total)) };
  const updateLine = (key: string, patch: Partial<ExpenseLine>) => setV((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const focusCell = (key: string, col: string) =>
    document.getElementById(gridId)?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-col="${col}"]`)?.focus();

  function addLine() {
    const last = v.lines[v.lines.length - 1];
    const line = newExpenseLine({ date: last?.date || v.date, vatRateId: data.defaultVatRateId ?? "", accountId: last?.accountId || data.defaultAccountId || "" });
    setV((p) => ({ ...p, lines: [...p.lines, line] }));
    setTimeout(() => focusCell(line.key, "date"), 0);
  }

  const payload = () => ({
    id: reportId,
    employeeId: v.employeeId,
    date: v.date,
    description: v.description,
    lines: v.lines
      .filter((l) => l.description || l.grossAmount)
      .map((l) => ({
        date: l.date || v.date,
        vendor: l.vendor,
        documentNumber: l.documentNumber,
        description: l.description,
        accountId: l.accountId,
        vatRateId: l.vatRateId,
        grossAmount: l.grossAmount,
      })),
  });

  function onError(res: { error: string; errorParams?: Record<string, string | number>; fieldErrors?: Record<string, string[]> }, msg: string) {
    const row = res.errorParams?.row;
    const fieldRow = Object.keys(res.fieldErrors ?? {})
      .map((k) => /^lines\.(\d+)\./.exec(k)?.[1])
      .find(Boolean);
    setErrorRow(typeof row === "number" ? row - 1 : fieldRow ? Number(fieldRow) : null);
    setError(res.error === "validation" ? (Object.keys(res.fieldErrors ?? {}).includes("employeeId") ? t("chooseEmployee") : ti("fixErrors")) : msg);
  }

  const editor = (
    <div
      className="min-w-0 space-y-4"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          run(() => saveExpenseReportAction(companyId, payload()), { success: ti("draftSaved"), refresh: false, onSuccess: (d) => router.replace(`/c/${companyId}/purchases/expenses/${d.id}/edit`), onError });
        }
      }}
    >
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[minmax(0,1.3fr)_180px_minmax(0,2fr)]">
          <FormField label={t("employee")} htmlFor="x-employee">
            <NativeSelect id="x-employee" value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })}>
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("reportDate")} htmlFor="x-date">
            <Input id="x-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </FormField>
          <FormField label={t("description")} htmlFor="x-desc">
            <Input id="x-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder={t("descriptionPlaceholder")} />
          </FormField>
        </CardContent>
      </Card>
      <FormError message={error} />
      <Card>
        <div id={gridId} className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 text-right font-medium">#</th>
                <th className="w-36 px-2 py-2 text-left font-medium">{t("receiptDate")}</th>
                <th className="w-36 px-2 py-2 text-left font-medium">{t("vendor")}</th>
                <th className="min-w-44 px-2 py-2 text-left font-medium">{ti("description")}</th>
                <th className="w-56 px-2 py-2 text-left font-medium">{ti("account")}</th>
                <th className="w-36 px-2 py-2 text-left font-medium">{ti("vat")}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t("gross")}</th>
                <th className="w-24 px-2 py-2 text-right font-medium">{ti("vatTotal")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {v.lines.map((l, i) => (
                <tr key={l.key} className={cn("align-top", errorRow === i && "bg-destructive/5")}>
                  <td className="px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-2 py-1">
                    <Input data-row={l.key} data-col="date" type="date" className="h-8" aria-label={`${t("receiptDate")} ${i + 1}`} value={l.date} onChange={(e) => updateLine(l.key, { date: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input className="h-8" aria-label={`${t("vendor")} ${i + 1}`} value={l.vendor} onChange={(e) => updateLine(l.key, { vendor: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input className="h-8" aria-label={`${ti("description")} ${i + 1}`} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Combobox
                      options={accountOptions}
                      value={l.accountId}
                      onChange={(id) => {
                        const a = data.accounts.find((x) => x.id === id);
                        updateLine(l.key, { accountId: id, vatRateId: l.vatRateId || a?.defaultVatRateId || "" });
                      }}
                      placeholder={ti("defaultAccount")}
                      noResults={ti("noAccounts")}
                      aria-label={`${ti("account")} ${i + 1}`}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      aria-label={`${ti("vat")} ${i + 1}`}
                      className="h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm"
                      value={l.vatRateId}
                      onChange={(e) => updateLine(l.key, { vatRateId: e.target.value })}
                    >
                      <option value="">—</option>
                      {data.vatRates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      inputMode="decimal"
                      className={cn("h-8 text-right tabular-nums", l.grossAmount && num(l.grossAmount) === null && "border-destructive")}
                      aria-label={`${t("gross")} ${i + 1}`}
                      value={l.grossAmount}
                      onChange={(e) => updateLine(l.key, { grossAmount: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const next = v.lines[i + 1];
                          if (next) focusCell(next.key, "date");
                          else addLine();
                        }
                      }}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">{formatMoney(results[i]?.vat ?? 0, locale)}</td>
                  <td className="px-1 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={ti("removeLine", { n: i + 1 })}
                      onClick={() => setV((p) => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((x) => x.key !== l.key) : [newExpenseLine({ date: p.date })] }))}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={addLine}>
            <Plus /> {t("addReceipt")}
          </Button>
        </div>
      </Card>
      <div className="sticky bottom-16 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-[0_-4px_12px_rgba(28,25,23,0.06)] backdrop-blur md:bottom-3">
        <span className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Receipt className="size-4 text-muted-foreground" /> {t("toReimburse")}: <b className="tabular-nums" data-testid="doc-total">{formatMoney(totals.total, locale)}</b>
          </span>
          <span className="text-muted-foreground">
            {ti("vatTotal")}: <span className="tabular-nums">{formatMoney(totals.vat, locale)}</span>
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => saveExpenseReportAction(companyId, payload()), {
              success: ti("draftSaved"),
              refresh: false,
              onSuccess: (d) => (reportId ? router.refresh() : router.replace(`/c/${companyId}/purchases/expenses/${d.id}/edit`)),
              onError,
            })
          }
        >
          {ti("saveDraft")}
        </Button>
        {canConfirm && (
          <Button
            type="button"
            disabled={pending || !v.employeeId}
            onClick={() =>
              run(() => confirmExpenseReportAction(companyId, payload()), {
                success: t("confirmed"),
                refresh: false,
                onSuccess: (d) => router.push(`/c/${companyId}/purchases/expenses?doc=${d.id}`),
                onError,
              })
            }
          >
            {ti("confirm")}
          </Button>
        )}
      </div>
    </div>
  );
  if (!side) return editor;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.6fr)]">
      {editor}
      <div className="xl:sticky xl:top-20 xl:self-start">{side}</div>
    </div>
  );
}
