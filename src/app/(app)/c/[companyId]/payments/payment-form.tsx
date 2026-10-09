"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney, parseMoneyInput, sum } from "@/lib/money";
import { cashEffect, signedPaymentAmount } from "@/lib/payments/posting";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { confirmPaymentAction, loadOpenItems, savePaymentAction } from "@/server/actions/payments";

type Direction = "IN" | "OUT" | "NETTING";
type PartyType = "CUSTOMER" | "SUPPLIER" | "EMPLOYEE" | "OTHER";
type DocType = "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT";

export type OpenItemView = {
  type: DocType;
  id: string;
  number: string;
  partyId: string | null;
  partyName: string;
  date: string;
  dueDate: string | null;
  currency: string;
  total: string;
  open: string;
  invoiceNumber?: string | null;
};

export type PaymentFormData = {
  bankAccounts: Array<{ id: string; name: string; kind: "BANK" | "CASH"; currency: string }>;
  customers: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; code: string; name: string }>;
};

export type PaymentValues = {
  direction: Direction;
  bankAccountId: string;
  date: string;
  amount: string;
  partyType: PartyType;
  partyId: string;
  partyName: string;
  referenceNumber: string;
  description: string;
  /** Valitud dokumendid: id → summa */
  docs: Record<string, { type: DocType; amount: string; number: string }>;
  prepayment: string;
  accountLines: Array<{ key: string; accountId: string; amount: string; description: string }>;
};

const num = (s: string) => (s.trim() === "" ? dec(0) : (parseMoneyInput(s) ?? null));
let seq = 0;
const newAccountLine = () => ({ key: `a${seq++}`, accountId: "", amount: "", description: "" });

const DOC_TYPES: Record<Direction, Record<PartyType, DocType[]>> = {
  IN: { CUSTOMER: ["SALES_INVOICE"], SUPPLIER: ["PURCHASE_INVOICE"], EMPLOYEE: ["EXPENSE_REPORT"], OTHER: [] },
  OUT: { CUSTOMER: ["SALES_INVOICE"], SUPPLIER: ["PURCHASE_INVOICE"], EMPLOYEE: ["EXPENSE_REPORT"], OTHER: [] },
  NETTING: { CUSTOMER: ["SALES_INVOICE", "PURCHASE_INVOICE"], SUPPLIER: ["SALES_INVOICE", "PURCHASE_INVOICE"], EMPLOYEE: ["EXPENSE_REPORT"], OTHER: ["SALES_INVOICE", "PURCHASE_INVOICE", "EXPENSE_REPORT"] },
};

export function PaymentForm({
  companyId,
  paymentId,
  initial,
  data,
  canConfirm,
}: {
  companyId: string;
  paymentId?: string;
  initial: PaymentValues;
  data: PaymentFormData;
  canConfirm: boolean;
}) {
  const t = useTranslations("payments");
  const ti = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<PaymentValues>(initial);
  const [result, setResult] = useState<{ key: string; items: OpenItemView[] }>({ key: "", items: [] });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PaymentValues>(k: K, value: PaymentValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const bank = data.bankAccounts.find((b) => b.id === v.bankAccountId);
  const currency = v.direction === "NETTING" ? "EUR" : (bank?.currency ?? "EUR");

  const types = DOC_TYPES[v.direction][v.partyType];
  const typesKey = types.join(",");
  // Osapoole tasumata dokumendid (laaditakse, kui osapool või suund muutub)
  const fetchKey = types.length === 0 || (v.partyType !== "OTHER" && !v.partyId) ? "" : `${v.direction}|${v.partyType}|${v.partyId}|${typesKey}`;
  const items = useMemo(() => (result.key === fetchKey ? result.items : []), [result, fetchKey]);
  const loading = fetchKey !== "" && result.key !== fetchKey;
  useEffect(() => {
    if (!fetchKey) return;
    let cancelled = false;
    loadOpenItems(companyId, {
      types,
      customerId: v.partyType === "CUSTOMER" && v.direction !== "NETTING" ? v.partyId : "",
      supplierId: v.partyType === "SUPPLIER" && v.direction !== "NETTING" ? v.partyId : "",
      employeeId: v.partyType === "EMPLOYEE" ? v.partyId : "",
    }).then((res) => {
      if (!cancelled) setResult({ key: fetchKey, items: res.ok ? res.data : [] });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, fetchKey]);

  // Juba valitud dokumendid jäävad nähtavaks ka siis, kui need pole enam „avatud“ nimekirjas
  const shownItems = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    const extra = Object.entries(v.docs)
      .filter(([id]) => !ids.has(id))
      .map(([id, d]): OpenItemView => ({ type: d.type, id, number: d.number, partyId: null, partyName: "", date: "", dueDate: null, currency, total: d.amount, open: d.amount }));
    return [...extra, ...items];
  }, [items, v.docs, currency]);

  const allocations = () => [
    ...Object.entries(v.docs).map(([id, d]) => ({
      type: d.type,
      salesInvoiceId: d.type === "SALES_INVOICE" ? id : "",
      purchaseInvoiceId: d.type === "PURCHASE_INVOICE" ? id : "",
      expenseReportId: d.type === "EXPENSE_REPORT" ? id : "",
      accountId: "",
      amount: d.amount,
      description: "",
    })),
    ...(v.prepayment && v.direction !== "NETTING"
      ? [{ type: "PREPAYMENT" as const, salesInvoiceId: "", purchaseInvoiceId: "", expenseReportId: "", accountId: "", amount: v.prepayment, description: "" }]
      : []),
    ...v.accountLines
      .filter((l) => l.accountId || l.amount)
      .map((l) => ({ type: "ACCOUNT" as const, salesInvoiceId: "", purchaseInvoiceId: "", expenseReportId: "", accountId: l.accountId, amount: l.amount, description: l.description })),
  ];

  const allocated = sum(allocations().map((a) => cashEffect(v.direction, a.type, num(a.amount) ?? dec(0))));
  const target = signedPaymentAmount(v.direction, num(v.amount) ?? dec(0));
  const diff = target.minus(allocated);
  const balanced = diff.isZero() && (v.direction === "NETTING" ? allocations().length > 0 : !(num(v.amount) ?? dec(0)).isZero());

  function toggle(item: OpenItemView, on: boolean) {
    setV((p) => {
      const docs = { ...p.docs };
      if (on) docs[item.id] = { type: item.type, amount: item.open, number: item.number };
      else delete docs[item.id];
      // Summa täidetakse valikust, kui kasutaja pole seda ise sisestanud
      let amount = p.amount;
      if (p.direction !== "NETTING") {
        const total = sum(Object.values(docs).map((d) => cashEffect(p.direction, d.type, num(d.amount) ?? dec(0)))).abs();
        if (!p.amount || p.amount === autoAmount(p)) amount = total.isZero() ? "" : total.toFixed(2);
      }
      return { ...p, docs, amount };
    });
  }

  function autoAmount(p: PaymentValues) {
    return sum(Object.values(p.docs).map((d) => cashEffect(p.direction, d.type, num(d.amount) ?? dec(0))))
      .abs()
      .toFixed(2);
  }

  const partyOptions: ComboOption[] = useMemo(() => {
    const list = v.partyType === "CUSTOMER" ? data.customers : v.partyType === "SUPPLIER" ? data.suppliers : v.partyType === "EMPLOYEE" ? data.employees : [];
    return list.map((x) => ({ value: x.id, label: x.name }));
  }, [v.partyType, data]);
  const accountOptions: ComboOption[] = useMemo(() => data.accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), [data.accounts]);

  const payload = () => ({
    id: paymentId,
    direction: v.direction,
    bankAccountId: v.direction === "NETTING" ? "" : v.bankAccountId,
    date: v.date,
    amount: v.direction === "NETTING" ? "0" : v.amount,
    currencyRate: "",
    partyType: v.partyType,
    customerId: v.partyType === "CUSTOMER" ? v.partyId : "",
    supplierId: v.partyType === "SUPPLIER" ? v.partyId : "",
    employeeId: v.partyType === "EMPLOYEE" ? v.partyId : "",
    partyName: v.partyName,
    partyIban: "",
    referenceNumber: v.referenceNumber,
    description: v.description,
    allocations: allocations(),
  });

  const onError = (_: unknown, msg: string) => setError(msg);
  const directionIcon = { IN: ArrowDownLeft, OUT: ArrowUpRight, NETTING: ArrowLeftRight };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("direction")}>
        {(["IN", "OUT", "NETTING"] as const).map((d) => {
          const Icon = directionIcon[d];
          return (
            <Button
              key={d}
              type="button"
              role="radio"
              aria-checked={v.direction === d}
              variant={v.direction === d ? "default" : "outline"}
              onClick={() => setV((p) => ({ ...p, direction: d, docs: {}, partyType: d === "IN" ? "CUSTOMER" : d === "OUT" ? (p.partyType === "CUSTOMER" ? "SUPPLIER" : p.partyType) : p.partyType }))}
            >
              <Icon /> {t(`directions.${d}`)}
            </Button>
          );
        })}
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-4">
          {v.direction !== "NETTING" && (
            <FormField label={v.direction === "IN" ? t("toAccount") : t("fromAccount")} htmlFor="pay-bank">
              <NativeSelect id="pay-bank" value={v.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
                {data.bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.currency !== "EUR" ? ` (${b.currency})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField label={ti("date")} htmlFor="pay-date">
            <Input id="pay-date" type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />
          </FormField>
          {v.direction !== "NETTING" && (
            <FormField label={t("amount")} htmlFor="pay-amount" hint={currency !== "EUR" ? currency : undefined}>
              <Input
                id="pay-amount"
                inputMode="decimal"
                className={cn("text-right tabular-nums", v.amount && num(v.amount) === null && "border-destructive")}
                value={v.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </FormField>
          )}
          <FormField label={t("partyType")} htmlFor="pay-party-type">
            <NativeSelect id="pay-party-type" value={v.partyType} onChange={(e) => setV((p) => ({ ...p, partyType: e.target.value as PartyType, partyId: "", docs: {} }))}>
              {(["CUSTOMER", "SUPPLIER", "EMPLOYEE", "OTHER"] as const).map((pt) => (
                <option key={pt} value={pt}>
                  {t(`partyTypes.${pt}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t("party")} htmlFor="pay-party" className="md:col-span-2">
            {v.partyType === "OTHER" ? (
              <Input id="pay-party" value={v.partyName} onChange={(e) => set("partyName", e.target.value)} />
            ) : (
              <Combobox
                options={partyOptions}
                value={v.partyId}
                onChange={(id) => setV((p) => ({ ...p, partyId: id, docs: {} }))}
                placeholder={t("partyPlaceholder")}
                aria-label={t("party")}
                ref={(el) => {
                  if (el) el.id = "pay-party";
                }}
              />
            )}
          </FormField>
          <FormField label={ti("referenceNumber")} htmlFor="pay-ref">
            <Input id="pay-ref" value={v.referenceNumber} onChange={(e) => set("referenceNumber", e.target.value)} />
          </FormField>
          <FormField label={t("description")} htmlFor="pay-desc">
            <Input id="pay-desc" value={v.description} onChange={(e) => set("description", e.target.value)} />
          </FormField>
        </CardContent>
      </Card>

      {types.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("openDocuments")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {loading ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground">{t("loading")}</p>
            ) : shownItems.length === 0 ? (
              <p className="px-5 pb-3 text-sm text-muted-foreground">{v.partyId || v.partyType === "OTHER" ? t("noOpenDocuments") : t("choosePartyFirst")}</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-y bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="w-10 px-3 py-2" />
                      <th className="px-2 py-2 text-left font-medium">{t("document")}</th>
                      <th className="hidden px-2 py-2 text-left font-medium md:table-cell">{t("party")}</th>
                      <th className="px-2 py-2 text-left font-medium">{ti("dueDate")}</th>
                      <th className="px-2 py-2 text-right font-medium">{t("open")}</th>
                      <th className="w-36 px-5 py-2 text-right font-medium">{t("allocate")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shownItems.map((item) => {
                      const selected = v.docs[item.id];
                      return (
                        <tr key={item.id} className={cn(selected && "bg-accent/40")}>
                          <td className="px-3 py-1.5">
                            <Checkbox label={<span className="sr-only">{item.number}</span>} checked={Boolean(selected)} onChange={(e) => toggle(item, e.target.checked)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="font-mono">{item.number}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {t(`docTypes.${item.type}`)}
                              {item.invoiceNumber ? ` · ${item.invoiceNumber}` : ""}
                            </span>
                          </td>
                          <td className="hidden px-2 py-1.5 md:table-cell">{item.partyName}</td>
                          <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{item.dueDate ? formatDate(parseISODate(item.dueDate)!, locale) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMoney(item.open, locale)}
                            {item.currency !== "EUR" && <span className="ml-1 text-xs text-muted-foreground">{item.currency}</span>}
                          </td>
                          <td className="px-5 py-1">
                            {selected && (
                              <Input
                                inputMode="decimal"
                                className="h-8 text-right tabular-nums"
                                aria-label={`${t("allocate")} ${item.number}`}
                                value={selected.amount}
                                onChange={(e) => setV((p) => ({ ...p, docs: { ...p.docs, [item.id]: { ...selected, amount: e.target.value } } }))}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("otherAllocations")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {v.direction !== "NETTING" && (v.partyType === "CUSTOMER" || v.partyType === "SUPPLIER") && (
            <FormField label={v.partyType === "CUSTOMER" ? t("customerPrepayment") : t("supplierPrepayment")} htmlFor="pay-prepayment" hint={t("prepaymentHint")} className="max-w-xs">
              <Input id="pay-prepayment" inputMode="decimal" className="text-right tabular-nums" value={v.prepayment} onChange={(e) => set("prepayment", e.target.value)} />
            </FormField>
          )}
          {v.accountLines.map((l, i) => (
            <div key={l.key} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_140px_minmax(0,1fr)_auto]">
              <Combobox
                options={accountOptions}
                value={l.accountId}
                onChange={(id) => set("accountLines", v.accountLines.map((x) => (x.key === l.key ? { ...x, accountId: id } : x)))}
                placeholder={ti("account")}
                aria-label={`${ti("account")} ${i + 1}`}
              />
              <Input
                inputMode="decimal"
                className="h-8 text-right tabular-nums"
                aria-label={`${t("amount")} ${i + 1}`}
                placeholder={v.direction === "NETTING" ? "±0,00" : "0,00"}
                value={l.amount}
                onChange={(e) => set("accountLines", v.accountLines.map((x) => (x.key === l.key ? { ...x, amount: e.target.value } : x)))}
              />
              <Input
                className="h-8"
                aria-label={`${t("description")} ${i + 1}`}
                placeholder={t("description")}
                value={l.description}
                onChange={(e) => set("accountLines", v.accountLines.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))}
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={ti("removeLine", { n: i + 1 })} onClick={() => set("accountLines", v.accountLines.filter((x) => x.key !== l.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => set("accountLines", [...v.accountLines, newAccountLine()])}>
            <Plus /> {t("addAccountLine")}
          </Button>
          <p className="text-xs text-muted-foreground">{v.direction === "NETTING" ? t("nettingAccountHint") : t("accountHint")}</p>
        </CardContent>
      </Card>

      <FormError message={error} />

      <div className="sticky bottom-16 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-[0_-4px_12px_rgba(28,25,23,0.06)] backdrop-blur md:bottom-3">
        <span role="status" className={cn("mr-auto text-sm font-medium", balanced ? "text-success" : "text-warning")}>
          {balanced ? t("balanced") : t("unallocated", { amount: formatMoney(diff.abs(), locale) })}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            run(() => savePaymentAction(companyId, payload()), {
              success: ti("draftSaved"),
              refresh: false,
              onSuccess: (d) => router.push(`/c/${companyId}/payments?doc=${d.id}`),
              onError,
            });
          }}
        >
          {ti("saveDraft")}
        </Button>
        {canConfirm && (
          <Button
            type="button"
            disabled={pending || !balanced}
            onClick={() => {
              setError(null);
              run(() => confirmPaymentAction(companyId, payload()), {
                success: t("confirmed"),
                refresh: false,
                onSuccess: (d) => router.push(`/c/${companyId}/payments?doc=${d.id}`),
                onError,
              });
            }}
          >
            {ti("confirm")}
          </Button>
        )}
        <span className="sr-only">{tc("save")}</span>
      </div>
    </div>
  );
}
