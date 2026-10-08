"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Columns3, HandCoins, Plus, Receipt, Trash2, UserPlus } from "lucide-react";
import { addDays, parseISODate, toISODate } from "@/lib/accounting/dates";
import { resolveVatRate } from "@/lib/accounting/vat";
import { dec, formatMoney, parseMoneyInput, roundMoney } from "@/lib/money";
import { calculateDocument, type VatKindLike } from "@/lib/sales/calc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Kbd } from "@/components/ui/command";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { saveCustomer } from "@/server/actions/customers";
import { newLine } from "./doc-line";

import { confirmSalesInvoice, saveQuoteAction, saveSalesInvoice } from "@/server/actions/sales";

export type EditorData = {
  customers: Array<{
    id: string;
    name: string;
    regCode: string | null;
    email: string | null;
    paymentTermDays: number | null;
    currency: string;
    defaultVatRateId: string | null;
  }>;
  items: Array<{
    id: string;
    code: string;
    name: string;
    unit: string | null;
    salePrice: string;
    purchasePrice: string;
    vatRateId: string | null;
    salesAccountId: string | null;
  }>;
  vatRates: Array<{
    id: string;
    code: string;
    name: string;
    kind: VatKindLike;
    periods: Array<{ rate: string; validFrom: string; validTo: string | null }>;
  }>;
  accounts: Array<{ id: string; code: string; name: string; requiresDepartment: boolean; requiredDimensionIds: string[] }>;
  departments: Array<{ id: string; code: string; name: string }>;
  dimensions: Array<{ id: string; name: string; values: Array<{ id: string; code: string; name: string }> }>;
  currencies: string[];
  baseCurrency: string;
  paymentTermDays: number;
  defaultVatRateId: string | null;
  prepayments: Array<{ id: string; number: string; customerId: string; date: string; remaining: Array<{ vatRateId: string | null; net: string }> }>;
};

export type DocLine = {
  key: string;
  itemId: string;
  code: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  vatRateId: string;
  accountId: string;
  departmentId: string;
  dims: Record<string, string>;
  unitCost: string;
  prepaymentInvoiceId: string;
};

export type DocValues = {
  customerId: string;
  date: string;
  dueDate: string;
  validUntil: string;
  deliveryDate: string;
  currency: string;
  currencyRate: string;
  pricesIncludeVat: boolean;
  yourReference: string;
  notes: string;
  lines: DocLine[];
};

const num = (s: string) => (s.trim() === "" ? dec(0) : (parseMoneyInput(s) ?? null));

export function SalesDocumentEditor({
  companyId,
  mode,
  type = "INVOICE",
  documentId,
  initial,
  data,
  canConfirm,
  rateDate,
  creditOf,
  taxFree,
}: {
  companyId: string;
  mode: "invoice" | "quote";
  type?: "INVOICE" | "CREDIT" | "PREPAYMENT";
  documentId?: string;
  initial: DocValues;
  data: EditorData;
  canConfirm: boolean;
  /** Kreeditarvel algse arve kuupäev (käibemaksumäär selle järgi) */
  rateDate?: string;
  creditOf?: { id: string; number: string } | null;
  taxFree?: boolean;
}) {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<DocValues>(() => ({ ...initial, lines: initial.lines.length ? initial.lines : [newLine()] }));
  const [customers, setCustomers] = useState(data.customers);
  const [dueTouched, setDueTouched] = useState(Boolean(documentId));
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [showExtra, setShowExtra] = useState(() =>
    initial.lines.some((l) => l.accountId || l.departmentId || Object.values(l.dims).some(Boolean)),
  );
  const [showMore, setShowMore] = useState(Boolean(initial.deliveryDate || initial.yourReference || initial.currency !== data.baseCurrency));
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const gridId = useId();
  const isCredit = type === "CREDIT";

  const vatById = useMemo(() => new Map(data.vatRates.map((r) => [r.id, r])), [data.vatRates]);
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const customer = customers.find((c) => c.id === v.customerId);
  const prepaymentDates = useMemo(() => new Map(data.prepayments.map((p) => [p.id, p.date])), [data.prepayments]);
  const itemOptions: ComboOption[] = useMemo(
    () => data.items.map((i) => ({ value: i.id, label: `${i.code} ${i.name}`, hint: i.salePrice ? formatMoney(i.salePrice, locale) : undefined })),
    [data.items, locale],
  );
  const accountOptions: ComboOption[] = useMemo(() => data.accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), [data.accounts]);
  const customerOptions: ComboOption[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name, hint: c.regCode ?? undefined, keywords: [c.regCode, c.email].filter(Boolean).join(" ") })),
    [customers],
  );

  const pctFor = (l: DocLine): string | null => {
    if (!l.vatRateId) return "0";
    const rate = vatById.get(l.vatRateId);
    if (!rate) return null;
    const dateStr = (l.prepaymentInvoiceId && prepaymentDates.get(l.prepaymentInvoiceId)) || rateDate || v.date;
    const date = parseISODate(dateStr);
    if (!date) return null;
    const pct = resolveVatRate(
      rate.periods.map((p) => ({ rate: p.rate, validFrom: parseISODate(p.validFrom)!, validTo: p.validTo ? parseISODate(p.validTo) : null })),
      date,
    );
    return pct ? pct.toString() : null;
  };

  const calc = useMemo(() => {
    const rows = v.lines.map((l) => ({
      quantity: num(l.quantity) ?? dec(0),
      unitPrice: num(l.unitPrice) ?? dec(0),
      discountPct: num(l.discountPct) ?? dec(0),
      vatRateId: l.vatRateId || null,
      vatPct: pctFor(l) ?? "0",
      vatKind: l.vatRateId ? (vatById.get(l.vatRateId)?.kind ?? null) : null,
      unitCost: num(l.unitCost) ?? dec(0),
    }));
    return calculateDocument(rows, { pricesIncludeVat: v.pricesIncludeVat });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lines, v.pricesIncludeVat, v.date, vatById, rateDate]);

  const hasMargin = v.lines.some((l) => l.vatRateId && vatById.get(l.vatRateId)?.kind === "MARGIN");
  const needsExtra = v.lines.some((l) => {
    const a = accountById.get(l.accountId);
    return a && (a.requiresDepartment || a.requiredDimensionIds.length > 0);
  });
  const extraVisible = showExtra || needsExtra;

  const set = <K extends keyof DocValues>(k: K, value: DocValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const updateLine = (key: string, patch: Partial<DocLine>) =>
    setV((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  function recomputeDue(date: string, customerId: string) {
    if (dueTouched || mode !== "invoice" || isCredit) return;
    const d = parseISODate(date);
    if (!d) return;
    const c = customers.find((x) => x.id === customerId);
    setV((p) => ({ ...p, dueDate: toISODate(addDays(d, c?.paymentTermDays ?? data.paymentTermDays)) }));
  }

  function chooseCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    setV((p) => ({ ...p, customerId: id, currency: c?.currency ?? p.currency }));
    recomputeDue(v.date, id);
    if (c && c.currency !== data.baseCurrency) setShowMore(true);
  }

  function chooseItem(key: string, itemId: string) {
    const item = itemById.get(itemId);
    if (!item) {
      updateLine(key, { itemId: "" });
      return;
    }
    updateLine(key, {
      itemId,
      code: item.code,
      description: item.name,
      unit: item.unit ?? "",
      unitPrice: item.salePrice,
      vatRateId: customer?.defaultVatRateId ?? item.vatRateId ?? data.defaultVatRateId ?? "",
      accountId: item.salesAccountId ?? "",
      unitCost: item.purchasePrice,
    });
  }

  function focusCell(key: string, col: string) {
    document.getElementById(gridId)?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-col="${col}"]`)?.focus();
  }

  function addLine() {
    const line = newLine({ vatRateId: customer?.defaultVatRateId ?? data.defaultVatRateId ?? "" });
    setV((p) => ({ ...p, lines: [...p.lines, line] }));
    setTimeout(() => focusCell(line.key, "item"), 0);
  }

  function nextRow(key: string) {
    const idx = v.lines.findIndex((l) => l.key === key);
    const next = v.lines[idx + 1];
    if (next) focusCell(next.key, "item");
    else addLine();
  }

  function addPrepayment(p: EditorData["prepayments"][number]) {
    const lines = p.remaining.map((r) => {
      let price = dec(r.net);
      if (v.pricesIncludeVat && r.vatRateId && vatById.get(r.vatRateId)?.kind === "TAXABLE") {
        const date = parseISODate(p.date)!;
        const rate = vatById.get(r.vatRateId)!;
        const pct = resolveVatRate(
          rate.periods.map((x) => ({ rate: x.rate, validFrom: parseISODate(x.validFrom)!, validTo: x.validTo ? parseISODate(x.validTo) : null })),
          date,
        );
        if (pct) price = price.plus(roundMoney(price.times(pct).dividedBy(100)));
      }
      return newLine({
        description: t("prepaymentLine", { number: p.number }),
        quantity: "-1",
        unitPrice: price.toFixed(2),
        vatRateId: r.vatRateId ?? "",
        prepaymentInvoiceId: p.id,
      });
    });
    setV((prev) => ({ ...prev, lines: [...prev.lines.filter((l) => l.description || l.itemId || l.unitPrice), ...lines] }));
  }

  function payload() {
    const lines = v.lines.map((l) => ({
      itemId: l.itemId,
      code: l.code,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      vatRateId: l.vatRateId,
      accountId: l.accountId,
      departmentId: l.departmentId,
      dimensionValueIds: Object.values(l.dims).filter(Boolean),
      unitCost: l.unitCost,
      prepaymentInvoiceId: l.prepaymentInvoiceId,
    }));
    return { lines };
  }

  function onError(res: { error: string; errorParams?: Record<string, string | number>; fieldErrors?: Record<string, string[]> }, msg: string) {
    const row = res.errorParams?.row;
    const fieldRow = Object.keys(res.fieldErrors ?? {})
      .map((k) => /^lines\.(\d+)\./.exec(k)?.[1])
      .find(Boolean);
    setErrorRow(typeof row === "number" ? row - 1 : fieldRow ? Number(fieldRow) : null);
    if (res.error === "validation") {
      const keys = Object.keys(res.fieldErrors ?? {});
      setError(fieldRow ? t("lineInvalid", { row: Number(fieldRow) + 1 }) : keys.includes("customerId") ? t("chooseCustomer") : t("fixErrors"));
    } else setError(msg);
  }

  const invoicePayload = () => ({
    id: documentId,
    type,
    customerId: v.customerId,
    date: v.date,
    dueDate: v.dueDate,
    deliveryDate: v.deliveryDate,
    currency: v.currency,
    currencyRate: v.currency === data.baseCurrency ? "" : v.currencyRate,
    pricesIncludeVat: v.pricesIncludeVat,
    yourReference: v.yourReference,
    notes: v.notes,
    creditOfId: creditOf?.id ?? "",
    ...payload(),
  });

  function save() {
    setError(null);
    setErrorRow(null);
    if (mode === "quote") {
      run(
        () =>
          saveQuoteAction(companyId, {
            id: documentId,
            customerId: v.customerId,
            date: v.date,
            validUntil: v.validUntil,
            currency: v.currency,
            pricesIncludeVat: v.pricesIncludeVat,
            yourReference: v.yourReference,
            notes: v.notes,
            ...payload(),
          }),
        {
          success: t("quoteSaved"),
          refresh: false,
          onSuccess: (d) => router.push(`/c/${companyId}/sales/quotes?doc=${d.id}`),
          onError,
        },
      );
      return;
    }
    run(() => saveSalesInvoice(companyId, invoicePayload()), {
      success: t("draftSaved"),
      refresh: false,
      onSuccess: (d) => {
        if (!documentId) router.replace(`/c/${companyId}/sales/invoices/${d.id}/edit`);
        else router.refresh();
      },
      onError,
    });
  }

  function confirmDoc() {
    setError(null);
    setErrorRow(null);
    run(() => confirmSalesInvoice(companyId, invoicePayload()), {
      success: t("confirmed"),
      refresh: false,
      onSuccess: (d) => router.push(`/c/${companyId}/sales/invoices?doc=${d.id}`),
      onError,
    });
  }

  const customerPrepayments = data.prepayments.filter(
    (p) => p.customerId === v.customerId && !v.lines.some((l) => l.prepaymentInvoiceId === p.id),
  );
  const currencyLabel = v.currency !== data.baseCurrency ? ` ${v.currency}` : "";

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
        } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canConfirm && mode === "invoice") {
          e.preventDefault();
          confirmDoc();
        }
      }}
    >
      {(creditOf || taxFree) && (
        <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm">
          {taxFree ? t("taxFreeInfo", { number: creditOf?.number ?? "" }) : t("creditInfo", { number: creditOf?.number ?? "" })}
        </div>
      )}
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
          <FormField label={t("customer")} htmlFor="doc-customer">
            <div className="flex gap-2">
              <Combobox
                className="flex-1"
                options={customerOptions}
                value={v.customerId}
                onChange={chooseCustomer}
                placeholder={t("customerPlaceholder")}
                noResults={t("noCustomers")}
                aria-label={t("customer")}
                disabled={Boolean(creditOf)}
                ref={(el) => {
                  if (el) el.id = "doc-customer";
                }}
              />
              {!creditOf && (
                <Button type="button" variant="outline" size="icon" aria-label={t("newCustomer")} title={t("newCustomer")} onClick={() => setNewCustomerOpen(true)}>
                  <UserPlus />
                </Button>
              )}
            </div>
          </FormField>
          <FormField label={t("date")} htmlFor="doc-date">
            <Input
              id="doc-date"
              type="date"
              value={v.date}
              onChange={(e) => {
                set("date", e.target.value);
                recomputeDue(e.target.value, v.customerId);
              }}
            />
          </FormField>
          {mode === "invoice" ? (
            <FormField label={t("dueDate")} htmlFor="doc-due">
              <Input
                id="doc-due"
                type="date"
                value={v.dueDate}
                onChange={(e) => {
                  setDueTouched(true);
                  set("dueDate", e.target.value);
                }}
              />
            </FormField>
          ) : (
            <FormField label={t("validUntil")} htmlFor="doc-valid">
              <Input id="doc-valid" type="date" value={v.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
            </FormField>
          )}
          {showMore && (
            <>
              <FormField label={t("yourReference")} htmlFor="doc-ref" hint={t("yourReferenceHint")}>
                <Input id="doc-ref" value={v.yourReference} onChange={(e) => set("yourReference", e.target.value)} />
              </FormField>
              {mode === "invoice" ? (
                <FormField label={t("deliveryDate")} htmlFor="doc-delivery">
                  <Input id="doc-delivery" type="date" value={v.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} />
                </FormField>
              ) : (
                <span className="hidden md:block" />
              )}
              <div className="grid grid-cols-2 gap-2">
                <FormField label={t("currency")} htmlFor="doc-currency">
                  <NativeSelect id="doc-currency" value={v.currency} onChange={(e) => set("currency", e.target.value)} disabled={Boolean(creditOf)}>
                    {data.currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {mode === "invoice" && v.currency !== data.baseCurrency && (
                  <FormField label={t("currencyRate")} htmlFor="doc-rate">
                    <Input
                      id="doc-rate"
                      inputMode="decimal"
                      placeholder={t("rateAuto")}
                      value={v.currencyRate}
                      onChange={(e) => set("currencyRate", e.target.value)}
                    />
                  </FormField>
                )}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 md:col-span-3">
            <Checkbox label={t("pricesIncludeVat")} checked={v.pricesIncludeVat} onChange={(e) => set("pricesIncludeVat", e.target.checked)} />
            {!showMore && (
              <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setShowMore(true)}>
                {t("moreFields")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <FormError message={error} />

      <Card>
        <div id={gridId} className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 text-right font-medium">#</th>
                <th className="w-48 px-2 py-2 text-left font-medium">{t("item")}</th>
                <th className="min-w-56 px-2 py-2 text-left font-medium">{t("description")}</th>
                <th className="w-20 px-2 py-2 text-right font-medium">{t("quantity")}</th>
                <th className="w-20 px-2 py-2 text-left font-medium">{t("unit")}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{v.pricesIncludeVat ? t("priceWithVat") : t("price")}</th>
                <th className="w-16 px-2 py-2 text-right font-medium">{t("discount")}</th>
                <th className="w-36 px-2 py-2 text-left font-medium">{t("vat")}</th>
                {hasMargin && <th className="w-28 px-2 py-2 text-right font-medium">{t("unitCost")}</th>}
                {extraVisible && <th className="w-56 px-2 py-2 text-left font-medium">{t("account")}</th>}
                {extraVisible && data.departments.length > 0 && <th className="w-36 px-2 py-2 text-left font-medium">{t("department")}</th>}
                {extraVisible &&
                  data.dimensions.map((d) => (
                    <th key={d.id} className="w-36 px-2 py-2 text-left font-medium">
                      {d.name}
                    </th>
                  ))}
                <th className="w-28 px-2 py-2 text-right font-medium">{t("amount")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {v.lines.map((l, i) => {
                const account = accountById.get(l.accountId);
                const vat = l.vatRateId ? vatById.get(l.vatRateId) : null;
                const pct = pctFor(l);
                const result = calc.lines[i];
                const enterTo = (col: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    if (col === "next") nextRow(l.key);
                    else focusCell(l.key, col);
                  }
                };
                const numInput = (col: "quantity" | "unitPrice" | "discountPct" | "unitCost", next: string, label: string) => (
                  <Input
                    data-row={l.key}
                    data-col={col}
                    inputMode="decimal"
                    className={cn("h-8 text-right tabular-nums", l[col] && num(l[col]) === null && "border-destructive")}
                    aria-label={`${label} ${i + 1}`}
                    value={l[col]}
                    onChange={(e) => updateLine(l.key, { [col]: e.target.value })}
                    onKeyDown={enterTo(next)}
                  />
                );
                return (
                  <tr key={l.key} className={cn("align-top", errorRow === i && "bg-destructive/5")}>
                    <td className="px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-2 py-1">
                      {l.prepaymentInvoiceId ? (
                        <Badge variant="secondary" className="mt-1.5">
                          <HandCoins className="size-3" /> {t("prepayment")}
                        </Badge>
                      ) : (
                        <Combobox
                          options={itemOptions}
                          value={l.itemId}
                          onChange={(id) => chooseItem(l.key, id)}
                          onCommit={() => focusCell(l.key, "quantity")}
                          placeholder={t("itemPlaceholder")}
                          noResults={t("noItems")}
                          aria-label={`${t("item")} ${i + 1}`}
                          ref={(el) => {
                            if (el) {
                              el.dataset.row = l.key;
                              el.dataset.col = "item";
                            }
                          }}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        data-row={l.key}
                        data-col="description"
                        className="h-8"
                        aria-label={`${t("description")} ${i + 1}`}
                        aria-invalid={errorRow === i || undefined}
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        onKeyDown={enterTo("quantity")}
                      />
                    </td>
                    <td className="px-2 py-1">{numInput("quantity", "unitPrice", t("quantity"))}</td>
                    <td className="px-2 py-1">
                      <Input
                        className="h-8"
                        list="doc-units"
                        aria-label={`${t("unit")} ${i + 1}`}
                        value={l.unit}
                        onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">{numInput("unitPrice", "next", t("price"))}</td>
                    <td className="px-2 py-1">{numInput("discountPct", "next", t("discount"))}</td>
                    <td className="px-2 py-1">
                      <select
                        aria-label={`${t("vat")} ${i + 1}`}
                        className={cn("h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm", l.vatRateId && pct === null && "border-destructive")}
                        value={l.vatRateId}
                        onChange={(e) => updateLine(l.key, { vatRateId: e.target.value })}
                        disabled={Boolean(l.prepaymentInvoiceId)}
                      >
                        <option value="">—</option>
                        {data.vatRates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      {vat?.kind === "TAXABLE" && pct && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">{formatMoney(pct, locale, { scale: 0 })}%</span>
                      )}
                    </td>
                    {hasMargin && (
                      <td className="px-2 py-1">{vat?.kind === "MARGIN" ? numInput("unitCost", "next", t("unitCost")) : null}</td>
                    )}
                    {extraVisible && (
                      <td className="px-2 py-1">
                        <Combobox
                          options={accountOptions}
                          value={l.accountId}
                          onChange={(id) => updateLine(l.key, { accountId: id })}
                          placeholder={l.prepaymentInvoiceId ? t("prepaymentAccount") : t("defaultAccount")}
                          noResults={t("noAccounts")}
                          aria-label={`${t("account")} ${i + 1}`}
                          disabled={Boolean(l.prepaymentInvoiceId) || type === "PREPAYMENT"}
                        />
                      </td>
                    )}
                    {extraVisible && data.departments.length > 0 && (
                      <td className="px-2 py-1">
                        <select
                          aria-label={`${t("department")} ${i + 1}`}
                          className={cn("h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm", account?.requiresDepartment && !l.departmentId && "border-warning")}
                          value={l.departmentId}
                          onChange={(e) => updateLine(l.key, { departmentId: e.target.value })}
                        >
                          <option value="">—</option>
                          {data.departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.code} {d.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {extraVisible &&
                      data.dimensions.map((d) => (
                        <td key={d.id} className="px-2 py-1">
                          <select
                            aria-label={`${d.name} ${i + 1}`}
                            className={cn(
                              "h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm",
                              account?.requiredDimensionIds.includes(d.id) && !l.dims[d.id] && "border-warning",
                            )}
                            value={l.dims[d.id] ?? ""}
                            onChange={(e) => updateLine(l.key, { dims: { ...l.dims, [d.id]: e.target.value } })}
                          >
                            <option value="">—</option>
                            {d.values.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.code} {x.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{result ? formatMoney(result.amount, locale) : ""}</td>
                    <td className="px-1 py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("removeLine", { n: i + 1 })}
                        onClick={() => setV((p) => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((x) => x.key !== l.key) : [newLine()] }))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="doc-units">
            {["tk", "h", "päev", "kuu", "km", "kg", "l", "m", "m²", "komplekt"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={addLine}>
            <Plus /> {t("addLine")}
          </Button>
          {mode === "invoice" && type === "INVOICE" && customerPrepayments.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  <HandCoins /> {t("deductPrepayment")} <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>{t("openPrepayments")}</DropdownMenuLabel>
                {customerPrepayments.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => addPrepayment(p)} className="justify-between">
                    <span className="font-mono">{p.number}</span>
                    <span className="tabular-nums">{formatMoney(p.remaining.reduce((s, r) => s.plus(r.net), dec(0)), locale)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowExtra((s) => !s)} disabled={needsExtra}>
            <Columns3 /> {extraVisible ? t("hideColumns") : t("showColumns")}
          </Button>
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Kbd>Enter</Kbd> {t("hintNext")} · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> {t("hintSave")}
            {canConfirm && mode === "invoice" && (
              <>
                {" "}
                · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> {t("hintConfirm")}
              </>
            )}
          </span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-5">
            <FormField label={t("notes")} htmlFor="doc-notes" hint={t("notesHint")}>
              <Textarea id="doc-notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
            </FormField>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1.5 pt-5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("net")}</span>
              <span className="tabular-nums">{formatMoney(calc.net, locale)}</span>
            </div>
            {calc.vatSummary
              .filter((s) => !s.vat.isZero())
              .map((s) => (
                <div key={`${s.vatRateId}${s.vatPct}`} className="flex justify-between">
                  <span className="text-muted-foreground">{t("vatAt", { pct: formatMoney(s.vatPct, locale, { scale: 0 }) })}</span>
                  <span className="tabular-nums">{formatMoney(s.vat, locale)}</span>
                </div>
              ))}
            {!calc.marginVat.isZero() && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("marginVat")}</span>
                <span className="tabular-nums">{formatMoney(calc.marginVat, locale)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <span>{t("total")}</span>
              <span className="tabular-nums" data-testid="doc-total">
                {formatMoney(calc.total, locale)}
                {currencyLabel}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-16 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-card/95 px-4 py-3 shadow-[0_-4px_12px_rgba(28,25,23,0.06)] backdrop-blur md:bottom-3">
        <span className="mr-auto flex items-center gap-2 text-sm font-medium">
          <Receipt className="size-4 text-muted-foreground" />
          {t("total")}: <b className="tabular-nums">{formatMoney(calc.total, locale)}{currencyLabel}</b>
        </span>
        <Button type="button" variant={mode === "quote" ? "default" : "outline"} disabled={pending} onClick={save}>
          {mode === "quote" ? tc("save") : t("saveDraft")}
        </Button>
        {mode === "invoice" && canConfirm && (
          <Button type="button" disabled={pending || !v.customerId} onClick={confirmDoc}>
            {t("confirm")}
          </Button>
        )}
      </div>

      {newCustomerOpen && (
        <QuickCustomerDialog
          companyId={companyId}
          baseCurrency={data.baseCurrency}
          onClose={() => setNewCustomerOpen(false)}
          onCreated={(c) => {
            setCustomers((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
            setV((p) => ({ ...p, customerId: c.id }));
            recomputeDue(v.date, c.id);
            setNewCustomerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function QuickCustomerDialog({
  companyId,
  baseCurrency,
  onClose,
  onCreated,
}: {
  companyId: string;
  baseCurrency: string;
  onClose: () => void;
  onCreated: (c: EditorData["customers"][number]) => void;
}) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState({ name: "", regCode: "", vatNumber: "", email: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setFieldErrors({});
            run(
              () =>
                saveCustomer(companyId, {
                  ...v,
                  isPerson: false,
                  countryCode: "EE",
                  addressStreet: "",
                  addressCity: "",
                  addressPostalCode: "",
                  addressCounty: "",
                  emailCc: "",
                  phone: "",
                  contactPerson: "",
                  paymentTermDays: "",
                  lateInterestPct: "",
                  locale: (["et", "en", "fi", "ru"] as const).find((l) => l === locale) ?? "et",
                  currency: baseCurrency,
                  referenceNumber: "",
                  groupId: "",
                  defaultVatRateId: "",
                  notes: "",
                  active: true,
                }),
              {
                success: t("created"),
                refresh: false,
                onSuccess: (d) =>
                  onCreated({
                    id: d.id,
                    name: v.name.trim(),
                    regCode: v.regCode || null,
                    email: v.email || null,
                    paymentTermDays: null,
                    currency: baseCurrency,
                    defaultVatRateId: null,
                  }),
                onError: (res) => setFieldErrors(res.fieldErrors ?? {}),
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormField label={t("name")} htmlFor="qc-name" errors={fieldErrors.name}>
              <Input id="qc-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("regCode")} htmlFor="qc-reg" errors={fieldErrors.regCode}>
                <Input id="qc-reg" value={v.regCode} onChange={(e) => setV({ ...v, regCode: e.target.value })} />
              </FormField>
              <FormField label={t("vatNumber")} htmlFor="qc-vat" errors={fieldErrors.vatNumber}>
                <Input id="qc-vat" value={v.vatNumber} onChange={(e) => setV({ ...v, vatNumber: e.target.value })} />
              </FormField>
            </div>
            <FormField label={t("email")} htmlFor="qc-email" errors={fieldErrors.email}>
              <Input id="qc-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
            </FormField>
            <p className="text-xs text-muted-foreground">{t("quickHint")}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !v.name.trim()}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
