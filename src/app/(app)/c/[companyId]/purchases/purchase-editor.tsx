"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Columns3, Loader2, Plus, Receipt, Sparkles, Trash2, UserPlus, Wand2 } from "lucide-react";
import type { AiInvoice } from "@/server/purchases/ai-extract";
import { toast } from "sonner";
import { normalizeIban } from "@/lib/iban";
import { extractInvoiceData, guessVatPct } from "@/lib/purchases/extract";
import { pdfText } from "@/lib/purchases/pdf-text";
import { addDays, parseISODate, toISODate } from "@/lib/accounting/dates";
import { resolveVatRate } from "@/lib/accounting/vat";
import { dec, formatMoney, parseMoneyInput } from "@/lib/money";
import { calculatePurchase } from "@/lib/purchases/calc";
import type { VatKindLike } from "@/lib/sales/calc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Kbd } from "@/components/ui/command";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { aiExtractPurchaseAction, confirmPurchaseInvoice, savePurchaseInvoice, savePurchaseOrderAction, uploadAttachment } from "@/server/actions/purchases";
import { saveSupplier } from "@/server/actions/suppliers";
import { newPurchaseLine, type PurchaseLine } from "./purchase-line";
import { PendingFiles } from "./pending-files";

export type PurchaseEditorData = {
  suppliers: Array<{
    id: string;
    name: string;
    regCode: string | null;
    vatNumber?: string | null;
    bankAccount?: string | null;
    paymentTermDays: number | null;
    currency: string;
    defaultAccountId: string | null;
    defaultVatRateId: string | null;
  }>;
  items: Array<{ id: string; code: string; name: string; unit: string | null; purchasePrice: string; vatRateId: string | null; purchaseAccountId: string | null }>;
  vatRates: Array<{ id: string; code: string; name: string; kind: VatKindLike; deductiblePct: string; periods: Array<{ rate: string; validFrom: string; validTo: string | null }> }>;
  accounts: Array<{ id: string; code: string; name: string; defaultVatRateId: string | null; requiresDepartment: boolean; requiredDimensionIds: string[] }>;
  departments: Array<{ id: string; code: string; name: string }>;
  dimensions: Array<{ id: string; name: string; values: Array<{ id: string; code: string; name: string }> }>;
  currencies: string[];
  baseCurrency: string;
  paymentTermDays: number;
  defaultAccountId: string | null;
  defaultVatRateId: string | null;
  own?: { regCode: string | null; vatNumber: string | null; ibans: string[] };
  /** AI-tuvastus on seadistatud (ANTHROPIC_API_KEY) */
  aiEnabled?: boolean;
};

type SupplierHint = { name: string; regCode: string; vatNumber: string; bankAccount: string };

export type PurchaseValues = {
  supplierId: string;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  referenceNumber: string;
  currency: string;
  currencyRate: string;
  pricesIncludeVat: boolean;
  notes: string;
  lines: PurchaseLine[];
};

const num = (s: string) => (s.trim() === "" ? dec(0) : (parseMoneyInput(s) ?? null));

export function PurchaseEditor({
  companyId,
  mode,
  documentId,
  initial,
  data,
  canConfirm,
  isCredit,
  side,
  extractFrom,
  autoExtract,
}: {
  companyId: string;
  mode: "invoice" | "order";
  documentId?: string;
  initial: PurchaseValues;
  data: PurchaseEditorData;
  canConfirm: boolean;
  isCredit?: boolean;
  /** Manuse eelvaade redaktori kõrval (ostuarve skaneering) */
  side?: React.ReactNode;
  /** Salvestatud manus, millest andmeid tuvastada */
  extractFrom?: { url: string; contentType: string; attachmentId: string } | null;
  /** Tuvasta kohe avamisel (üleslaaditud ja veel täitmata mustand) */
  autoExtract?: boolean;
}) {
  const t = useTranslations("purchases");
  const ti = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState<PurchaseValues>(() => ({
    ...initial,
    lines: initial.lines.length ? initial.lines : [newPurchaseLine({ vatRateId: data.defaultVatRateId ?? "" })],
  }));
  const [suppliers, setSuppliers] = useState(data.suppliers);
  const [dueTouched, setDueTouched] = useState(Boolean(documentId && initial.supplierId));
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [showExtra, setShowExtra] = useState(() => initial.lines.some((l) => l.departmentId || Object.values(l.dims).some(Boolean)));
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplierInitial, setNewSupplierInitial] = useState<SupplierHint | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractInfo, setExtractInfo] = useState<{ filled: string[]; warnings: string[]; supplierHint: SupplierHint | null } | null>(null);
  const te = useTranslations("errors");
  const gridId = useId();

  const vatById = useMemo(() => new Map(data.vatRates.map((r) => [r.id, r])), [data.vatRates]);
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const supplier = suppliers.find((s) => s.id === v.supplierId);
  const itemOptions: ComboOption[] = useMemo(() => data.items.map((i) => ({ value: i.id, label: `${i.code} ${i.name}` })), [data.items]);
  const accountOptions: ComboOption[] = useMemo(() => data.accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), [data.accounts]);
  const supplierOptions: ComboOption[] = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.regCode ?? undefined, keywords: s.regCode ?? "" })),
    [suppliers],
  );

  const pctOf = (rateId: string, dateStr: string) => {
    const rate = vatById.get(rateId);
    const date = parseISODate(dateStr);
    if (!rate || !date) return null;
    return resolveVatRate(
      rate.periods.map((p) => ({ rate: p.rate, validFrom: parseISODate(p.validFrom)!, validTo: p.validTo ? parseISODate(p.validTo) : null })),
      date,
    );
  };
  const standardPct = useMemo(() => {
    const std = data.vatRates.find((r) => r.kind === "TAXABLE" && dec(r.deductiblePct).equals(100));
    return std ? (pctOf(std.id, v.date)?.toString() ?? null) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.vatRates, v.date]);

  const calc = useMemo(
    () =>
      calculatePurchase(
        v.lines.map((l) => {
          const rate = l.vatRateId ? vatById.get(l.vatRateId) : null;
          return {
            quantity: num(l.quantity) ?? dec(0),
            unitPrice: num(l.unitPrice) ?? dec(0),
            discountPct: num(l.discountPct) ?? dec(0),
            vatRateId: l.vatRateId || null,
            vatPct: l.vatRateId ? (pctOf(l.vatRateId, v.date)?.toString() ?? "0") : "0",
            vatKind: rate?.kind ?? null,
            deductiblePct: rate?.deductiblePct ?? "100",
          };
        }),
        { pricesIncludeVat: v.pricesIncludeVat, standardPct },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.lines, v.pricesIncludeVat, v.date, vatById, standardPct],
  );

  const needsExtra = v.lines.some((l) => {
    const a = accountById.get(l.accountId);
    return a && (a.requiresDepartment || a.requiredDimensionIds.length > 0);
  });
  const extraVisible = showExtra || needsExtra;
  const set = <K extends keyof PurchaseValues>(k: K, value: PurchaseValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const updateLine = (key: string, patch: Partial<PurchaseLine>) =>
    setV((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  function recomputeDue(date: string, supplierId: string) {
    if (dueTouched || mode !== "invoice" || isCredit) return;
    const d = parseISODate(date);
    if (!d) return;
    const s = suppliers.find((x) => x.id === supplierId);
    setV((p) => ({ ...p, dueDate: toISODate(addDays(d, s?.paymentTermDays ?? data.paymentTermDays)) }));
  }

  function chooseSupplier(id: string) {
    const s = suppliers.find((x) => x.id === id);
    setV((p) => ({
      ...p,
      supplierId: id,
      currency: s?.currency ?? p.currency,
      // Tühjadele ridadele tarnija vaikimisi konto ja KM
      lines: p.lines.map((l) =>
        l.description || l.itemId || l.unitPrice
          ? l
          : { ...l, accountId: s?.defaultAccountId ?? l.accountId, vatRateId: s?.defaultVatRateId ?? (l.vatRateId || data.defaultVatRateId || "") },
      ),
    }));
    recomputeDue(v.date, id);
  }

  /** Rakendab dokumendi tekstist tuvastatud andmed tühjadele väljadele ja annab kokkuvõtte. */
  function applyExtraction(text: string) {
    if (!text.trim()) {
      setExtractInfo({ filled: [], warnings: [t("extractNoText")], supplierHint: null });
      return;
    }
    const r = extractInvoiceData(text, { regCode: data.own?.regCode, vatNumber: data.own?.vatNumber, ibans: data.own?.ibans });
    const filled: string[] = [];
    const warnings: string[] = [];
    let sup = suppliers.find((s) => s.id === v.supplierId);
    let supplierHint: SupplierHint | null = null;
    if (!sup) {
      sup = suppliers.find(
        (s) =>
          (s.regCode && r.regCodes.includes(s.regCode)) ||
          (s.vatNumber && r.vatNumbers.includes(s.vatNumber.toUpperCase())) ||
          (s.bankAccount && r.ibans.includes(normalizeIban(s.bankAccount))),
      );
      if (sup) filled.push(t("supplier"));
      else if (r.regCodes.length || r.vatNumbers.length) {
        supplierHint = { name: "", regCode: r.regCodes[0] ?? "", vatNumber: r.vatNumbers[0] ?? "", bankAccount: r.ibans[0] ?? "" };
        warnings.push(t("extractSupplierMissing", { code: r.regCodes[0] ?? r.vatNumbers[0] ?? "" }));
      }
    }
    if (r.invoiceNumber && !v.invoiceNumber) filled.push(t("invoiceNumber"));
    if (r.date) filled.push(ti("date"));
    if (r.dueDate) filled.push(ti("dueDate"));
    if (r.referenceNumber && !v.referenceNumber) filled.push(ti("referenceNumber"));
    const linesEmpty = v.lines.every((l) => !l.description && !l.unitPrice && !l.itemId);
    const amount = r.net ?? r.total;
    const date = r.date ?? v.date;
    const pct = guessVatPct(r.net, r.vat);
    const rateForPct =
      pct === null
        ? undefined
        : data.vatRates.find((rate) => rate.kind === "TAXABLE" && dec(rate.deductiblePct).equals(100) && pctOf(rate.id, date)?.toNumber() === pct)?.id;
    if (linesEmpty && amount) filled.push(t("extractAmount", { amount: formatMoney(r.total ?? amount, locale) }));
    if (r.net && r.vat && r.total && Math.abs(Number(r.net) + Number(r.vat) - Number(r.total)) > 0.02) warnings.push(t("extractTotalsMismatch"));
    setV((p) => ({
      ...p,
      supplierId: sup && !p.supplierId ? sup.id : p.supplierId,
      currency: sup && !p.supplierId ? sup.currency : r.currency && data.currencies.includes(r.currency) ? r.currency : p.currency,
      invoiceNumber: p.invoiceNumber || r.invoiceNumber || "",
      date: r.date ?? p.date,
      dueDate: r.dueDate ?? p.dueDate,
      referenceNumber: p.referenceNumber || r.referenceNumber || "",
      pricesIncludeVat: linesEmpty && amount ? !r.net : p.pricesIncludeVat,
      lines:
        linesEmpty && amount
          ? [
              newPurchaseLine({
                description: r.invoiceNumber ? t("extractLine", { number: r.invoiceNumber }) : t("extractLineNoNumber"),
                unitPrice: amount,
                vatRateId: rateForPct ?? sup?.defaultVatRateId ?? data.defaultVatRateId ?? "",
                accountId: sup?.defaultAccountId ?? data.defaultAccountId ?? "",
              }),
            ]
          : p.lines,
    }));
    if (r.dueDate) setDueTouched(true);
    else if (sup && !v.supplierId) recomputeDue(date, sup.id);
    if (filled.length === 0 && warnings.length === 0) warnings.push(t("extractNothing"));
    setExtractInfo({ filled, warnings, supplierHint });
  }

  /** AI tulemuse rakendamine: päis tühjadele väljadele, read (artiklid koodi järgi), KM määr protsendi järgi. */
  function applyAi(r: AiInvoice) {
    const filled: string[] = [];
    const warnings: string[] = [];
    const up = (x: string | null) => x?.replace(/\s+/g, "").toUpperCase() ?? null;
    let sup = suppliers.find((s) => s.id === v.supplierId);
    let supplierHint: SupplierHint | null = null;
    if (!sup) {
      sup = suppliers.find(
        (s) =>
          (s.regCode && s.regCode === r.supplierRegCode) ||
          (s.vatNumber && up(s.vatNumber) === up(r.supplierVatNumber)) ||
          (s.bankAccount && r.supplierIban && normalizeIban(s.bankAccount) === normalizeIban(r.supplierIban)) ||
          (r.supplierName && s.name.toLowerCase() === r.supplierName.toLowerCase()),
      );
      if (sup) filled.push(t("supplier"));
      else if (r.supplierName || r.supplierRegCode) {
        supplierHint = { name: r.supplierName ?? "", regCode: r.supplierRegCode ?? "", vatNumber: up(r.supplierVatNumber) ?? "", bankAccount: up(r.supplierIban) ?? "" };
        warnings.push(t("extractSupplierMissing", { code: r.supplierName ?? r.supplierRegCode ?? "" }));
      }
    }
    const date = r.invoiceDate && parseISODate(r.invoiceDate) ? r.invoiceDate : v.date;
    const rateFor = (pct: string | null) => {
      if (pct === null || pct === "") return undefined;
      const n = Number(pct);
      return data.vatRates.find((rate) => rate.kind === "TAXABLE" && dec(rate.deductiblePct).equals(100) && pctOf(rate.id, date)?.toNumber() === n)?.id;
    };
    const lines = r.lines
      .filter((l) => l.description.trim())
      .map((l) => {
        const item = l.itemCode ? data.items.find((i) => i.code === l.itemCode) : undefined;
        return newPurchaseLine({
          itemId: item?.id ?? "",
          code: item?.code ?? "",
          description: l.description,
          quantity: parseMoneyInput(l.quantity) ? l.quantity : "1",
          unit: l.unit ?? item?.unit ?? "",
          unitPrice: l.unitPrice,
          vatRateId: rateFor(l.vatPct) ?? sup?.defaultVatRateId ?? item?.vatRateId ?? data.defaultVatRateId ?? "",
          accountId: item?.purchaseAccountId ?? sup?.defaultAccountId ?? data.defaultAccountId ?? "",
        });
      });
    const linesEmpty = v.lines.every((l) => !l.description && !l.unitPrice && !l.itemId);
    const replaceLines = lines.length > 0 && (linesEmpty || confirm(t("aiReplaceLines")));
    if (r.invoiceNumber && !v.invoiceNumber) filled.push(t("invoiceNumber"));
    if (r.invoiceDate) filled.push(ti("date"));
    if (r.dueDate) filled.push(ti("dueDate"));
    if (replaceLines) filled.push(t("aiLines", { count: lines.length }));
    if (lines.some((l) => l.itemId)) filled.push(t("aiItems", { count: lines.filter((l) => l.itemId).length }));
    setV((p) => ({
      ...p,
      supplierId: sup && !p.supplierId ? sup.id : p.supplierId,
      currency: sup && !p.supplierId ? sup.currency : r.currency && data.currencies.includes(r.currency) ? r.currency : p.currency,
      invoiceNumber: p.invoiceNumber || r.invoiceNumber || "",
      date,
      dueDate: r.dueDate && parseISODate(r.dueDate) ? r.dueDate : p.dueDate,
      referenceNumber: p.referenceNumber || r.referenceNumber?.replace(/\s+/g, "") || "",
      pricesIncludeVat: replaceLines ? r.pricesIncludeVat : p.pricesIncludeVat,
      lines: replaceLines ? lines : p.lines,
    }));
    if (r.dueDate) setDueTouched(true);
    else if (sup && !v.supplierId) recomputeDue(date, sup.id);
    if (r.total) warnings.push(t("aiCheckTotal", { total: formatMoney(r.total, locale) }));
    setExtractInfo({ filled, warnings, supplierHint });
  }

  async function extractWithAi(source: File | { attachmentId: string }) {
    setExtracting(true);
    try {
      const res = await aiExtractPurchaseAction(companyId, source instanceof File ? { file: source } : { attachmentId: source.attachmentId });
      if (res.ok) applyAi(res.data);
      else toast.error(te.has(res.error) ? te(res.error) : te("unexpected"));
    } finally {
      setExtracting(false);
    }
  }

  async function extractFromSource(source: File | { url: string; contentType: string; attachmentId: string }) {
    const type = source instanceof File ? source.type : source.contentType;
    if (type !== "application/pdf") {
      if (data.aiEnabled) return extractWithAi(source);
      setExtractInfo({ filled: [], warnings: [t("extractImage")], supplierHint: null });
      return;
    }
    setExtracting(true);
    let text = "";
    try {
      text = await pdfText(source instanceof File ? await source.arrayBuffer() : source.url);
    } catch {
      toast.error(t("extractFailed"));
      setExtracting(false);
      return;
    }
    setExtracting(false);
    // Skaneeritud PDF (tekstikiht puudub) → AI, kui see on seadistatud
    if (!text.trim() && data.aiEnabled) return extractWithAi(source);
    applyExtraction(text);
  }
  const extractSource = pendingFiles.find((f) => f.type === "application/pdf") ?? pendingFiles[0] ?? extractFrom ?? null;

  // Üleslaaditud mustandi esmakordsel avamisel tuvastame andmed kohe
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoExtract || autoDone.current || !extractFrom) return;
    autoDone.current = true;
    void extractFromSource(extractFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExtract, extractFrom]);

  function onPendingChange(files: File[]) {
    const first = pendingFiles.length === 0 && files.length > 0;
    setPendingFiles(files);
    // Esimesest failist tuvastame andmed kohe
    if (first) void extractFromSource(files.find((f) => f.type === "application/pdf") ?? files[0]!);
  }

  /** Ootel failid üles pärast arve salvestamist. */
  async function uploadPending(invoiceId: string) {
    for (const file of pendingFiles) {
      const res = await uploadAttachment(companyId, { documentType: "PurchaseInvoice", documentId: invoiceId, file });
      if (!res.ok) toast.error(t("uploadFailed", { name: file.name }));
    }
  }

  function chooseItem(key: string, itemId: string) {
    const item = itemById.get(itemId);
    if (!item) return updateLine(key, { itemId: "" });
    updateLine(key, {
      itemId,
      code: item.code,
      description: item.name,
      unit: item.unit ?? "",
      unitPrice: item.purchasePrice,
      vatRateId: supplier?.defaultVatRateId ?? item.vatRateId ?? data.defaultVatRateId ?? "",
      accountId: item.purchaseAccountId ?? supplier?.defaultAccountId ?? "",
    });
  }

  function chooseAccount(key: string, accountId: string) {
    const a = accountById.get(accountId);
    const line = v.lines.find((l) => l.key === key);
    updateLine(key, { accountId, vatRateId: line?.vatRateId || a?.defaultVatRateId || "" });
  }

  function focusCell(key: string, col: string) {
    document.getElementById(gridId)?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-col="${col}"]`)?.focus();
  }

  function addLine() {
    const line = newPurchaseLine({
      vatRateId: supplier?.defaultVatRateId ?? data.defaultVatRateId ?? "",
      accountId: supplier?.defaultAccountId ?? "",
    });
    setV((p) => ({ ...p, lines: [...p.lines, line] }));
    setTimeout(() => focusCell(line.key, "description"), 0);
  }

  function nextRow(key: string) {
    const idx = v.lines.findIndex((l) => l.key === key);
    const next = v.lines[idx + 1];
    if (next) focusCell(next.key, "description");
    else addLine();
  }

  const lines = () =>
    v.lines.map((l) => ({
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
    }));

  function onError(res: { error: string; errorParams?: Record<string, string | number>; fieldErrors?: Record<string, string[]> }, msg: string) {
    const row = res.errorParams?.row;
    const fieldRow = Object.keys(res.fieldErrors ?? {})
      .map((k) => /^lines\.(\d+)\./.exec(k)?.[1])
      .find(Boolean);
    setErrorRow(typeof row === "number" ? row - 1 : fieldRow ? Number(fieldRow) : null);
    if (res.error === "validation") {
      const keys = Object.keys(res.fieldErrors ?? {});
      setError(fieldRow ? ti("lineInvalid", { row: Number(fieldRow) + 1 }) : keys.includes("supplierId") ? t("chooseSupplier") : ti("fixErrors"));
    } else setError(msg);
  }

  const invoicePayload = () => ({
    id: documentId,
    isCredit,
    supplierId: v.supplierId,
    invoiceNumber: v.invoiceNumber,
    date: v.date,
    dueDate: v.dueDate,
    referenceNumber: v.referenceNumber,
    currency: v.currency,
    currencyRate: v.currency === data.baseCurrency ? "" : v.currencyRate,
    pricesIncludeVat: v.pricesIncludeVat,
    notes: v.notes,
    lines: lines(),
  });

  function save() {
    setError(null);
    setErrorRow(null);
    if (mode === "order") {
      run(
        () =>
          savePurchaseOrderAction(companyId, {
            id: documentId,
            supplierId: v.supplierId,
            date: v.date,
            expectedDate: v.dueDate,
            currency: v.currency,
            pricesIncludeVat: v.pricesIncludeVat,
            notes: v.notes,
            lines: lines(),
          }),
        { success: t("orderSaved"), refresh: false, onSuccess: (d) => router.push(`/c/${companyId}/purchases/orders?doc=${d.id}`), onError },
      );
      return;
    }
    run(async () => {
      const res = await savePurchaseInvoice(companyId, invoicePayload());
      if (res.ok && pendingFiles.length) await uploadPending(res.data.id);
      return res;
    }, {
      success: ti("draftSaved"),
      refresh: false,
      onSuccess: (d) => {
        if (!documentId) router.replace(`/c/${companyId}/purchases/invoices/${d.id}/edit`);
        else router.refresh();
      },
      onError,
    });
  }

  function confirmDoc() {
    setError(null);
    setErrorRow(null);
    run(async () => {
      const res = await confirmPurchaseInvoice(companyId, invoicePayload());
      if (res.ok && pendingFiles.length) await uploadPending(res.data.id);
      return res;
    }, {
      success: t("confirmed"),
      refresh: false,
      onSuccess: (d) => router.push(`/c/${companyId}/purchases/invoices?doc=${d.id}`),
      onError,
    });
  }

  const currencyLabel = v.currency !== data.baseCurrency ? ` ${v.currency}` : "";

  const editor = (
    <div
      className="min-w-0 space-y-4"
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
      {isCredit && <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm">{t("creditInfo")}</div>}
      {mode === "invoice" && extractSource && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-card px-4 py-2.5 text-sm" role="status" data-testid="extract-banner">
          <Wand2 className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 space-y-0.5">
            {extracting ? (
              <p>{t("extracting")}</p>
            ) : extractInfo ? (
              <>
                {extractInfo.filled.length > 0 && <p>{t("extractFilled", { fields: extractInfo.filled.join(", ") })}</p>}
                {extractInfo.warnings.map((w) => (
                  <p key={w} className="text-warning">
                    {w}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-muted-foreground">{t("extractIntro")}</p>
            )}
          </div>
          {extractInfo?.supplierHint && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNewSupplierInitial(extractInfo.supplierHint);
                setNewSupplierOpen(true);
              }}
            >
              <UserPlus /> {t("newSupplier")}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={extracting} onClick={() => void extractFromSource(extractSource)}>
            {extracting ? <Loader2 className="animate-spin" /> : <Wand2 />} {t("extractButton")}
          </Button>
          {data.aiEnabled && (
            <Button type="button" size="sm" variant="outline" disabled={extracting} onClick={() => void extractWithAi(extractSource)} title={t("aiHint")}>
              <Sparkles /> {t("aiButton")}
            </Button>
          )}
        </div>
      )}
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
          <FormField label={t("supplier")} htmlFor="pdoc-supplier">
            <div className="flex gap-2">
              <Combobox
                className="flex-1"
                options={supplierOptions}
                value={v.supplierId}
                onChange={chooseSupplier}
                placeholder={t("supplierPlaceholder")}
                noResults={t("noSuppliers")}
                aria-label={t("supplier")}
                ref={(el) => {
                  if (el) el.id = "pdoc-supplier";
                }}
              />
              <Button type="button" variant="outline" size="icon" aria-label={t("newSupplier")} title={t("newSupplier")} onClick={() => setNewSupplierOpen(true)}>
                <UserPlus />
              </Button>
            </div>
          </FormField>
          {mode === "invoice" ? (
            <FormField label={t("invoiceNumber")} htmlFor="pdoc-number">
              <Input id="pdoc-number" value={v.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} />
            </FormField>
          ) : (
            <span className="hidden md:block" />
          )}
          <FormField label={ti("date")} htmlFor="pdoc-date">
            <Input
              id="pdoc-date"
              type="date"
              value={v.date}
              onChange={(e) => {
                set("date", e.target.value);
                recomputeDue(e.target.value, v.supplierId);
              }}
            />
          </FormField>
          <FormField label={mode === "invoice" ? ti("dueDate") : t("expectedDate")} htmlFor="pdoc-due">
            <Input
              id="pdoc-due"
              type="date"
              value={v.dueDate}
              onChange={(e) => {
                setDueTouched(true);
                set("dueDate", e.target.value);
              }}
            />
          </FormField>
          {mode === "invoice" ? (
            <FormField label={ti("referenceNumber")} htmlFor="pdoc-ref">
              <Input id="pdoc-ref" inputMode="numeric" value={v.referenceNumber} onChange={(e) => set("referenceNumber", e.target.value)} />
            </FormField>
          ) : (
            <span className="hidden md:block" />
          )}
          <div className="grid grid-cols-2 gap-2">
            <FormField label={ti("currency")} htmlFor="pdoc-currency">
              <NativeSelect id="pdoc-currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                {data.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            {mode === "invoice" && v.currency !== data.baseCurrency && (
              <FormField label={ti("currencyRate")} htmlFor="pdoc-rate">
                <Input id="pdoc-rate" inputMode="decimal" placeholder={ti("rateAuto")} value={v.currencyRate} onChange={(e) => set("currencyRate", e.target.value)} />
              </FormField>
            )}
          </div>
          <div className="md:col-span-3">
            <Checkbox label={ti("pricesIncludeVat")} checked={v.pricesIncludeVat} onChange={(e) => set("pricesIncludeVat", e.target.checked)} />
          </div>
        </CardContent>
      </Card>

      <FormError message={error} />

      <Card>
        <div id={gridId} className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2 text-right font-medium">#</th>
                <th className="w-40 px-2 py-2 text-left font-medium">{ti("item")}</th>
                <th className="min-w-48 px-2 py-2 text-left font-medium">{ti("description")}</th>
                <th className="w-56 px-2 py-2 text-left font-medium">{ti("account")}</th>
                <th className="w-20 px-2 py-2 text-right font-medium">{ti("quantity")}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{v.pricesIncludeVat ? ti("priceWithVat") : ti("price")}</th>
                <th className="w-16 px-2 py-2 text-right font-medium">{ti("discount")}</th>
                <th className="w-36 px-2 py-2 text-left font-medium">{ti("vat")}</th>
                {extraVisible && data.departments.length > 0 && <th className="w-36 px-2 py-2 text-left font-medium">{ti("department")}</th>}
                {extraVisible &&
                  data.dimensions.map((d) => (
                    <th key={d.id} className="w-36 px-2 py-2 text-left font-medium">
                      {d.name}
                    </th>
                  ))}
                <th className="w-28 px-2 py-2 text-right font-medium">{ti("amount")}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {v.lines.map((l, i) => {
                const account = accountById.get(l.accountId);
                const rate = l.vatRateId ? vatById.get(l.vatRateId) : null;
                const pct = l.vatRateId ? pctOf(l.vatRateId, v.date) : null;
                const result = calc.lines[i];
                const enterTo = (col: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    if (col === "next") nextRow(l.key);
                    else focusCell(l.key, col);
                  }
                };
                const numInput = (col: "quantity" | "unitPrice" | "discountPct", next: string, label: string) => (
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
                      <Combobox
                        options={itemOptions}
                        value={l.itemId}
                        onChange={(id) => chooseItem(l.key, id)}
                        onCommit={() => focusCell(l.key, "quantity")}
                        placeholder={ti("itemPlaceholder")}
                        noResults={ti("noItems")}
                        aria-label={`${ti("item")} ${i + 1}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        data-row={l.key}
                        data-col="description"
                        className="h-8"
                        aria-label={`${ti("description")} ${i + 1}`}
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        onKeyDown={enterTo("account")}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Combobox
                        options={accountOptions}
                        value={l.accountId}
                        onChange={(id) => chooseAccount(l.key, id)}
                        onCommit={() => focusCell(l.key, "quantity")}
                        placeholder={supplier?.defaultAccountId ? ti("defaultAccount") : t("accountPlaceholder")}
                        noResults={ti("noAccounts")}
                        aria-label={`${ti("account")} ${i + 1}`}
                        ref={(el) => {
                          if (el) {
                            el.dataset.row = l.key;
                            el.dataset.col = "account";
                          }
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">{numInput("quantity", "unitPrice", ti("quantity"))}</td>
                    <td className="px-2 py-1">{numInput("unitPrice", "next", ti("price"))}</td>
                    <td className="px-2 py-1">{numInput("discountPct", "next", ti("discount"))}</td>
                    <td className="px-2 py-1">
                      <select
                        aria-label={`${ti("vat")} ${i + 1}`}
                        className={cn("h-8 w-full rounded-md border border-input bg-card px-1.5 text-sm", l.vatRateId && pct === null && "border-destructive")}
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
                      {rate && result && !result.reverseVat.isZero() && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("reverseShort", { amount: formatMoney(result.reverseVat, locale) })}</span>
                      )}
                      {rate && !dec(rate.deductiblePct).equals(100) && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{t("deductibleShort", { pct: formatMoney(rate.deductiblePct, locale, { scale: 0 }) })}</span>
                      )}
                    </td>
                    {extraVisible && data.departments.length > 0 && (
                      <td className="px-2 py-1">
                        <select
                          aria-label={`${ti("department")} ${i + 1}`}
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
                        aria-label={ti("removeLine", { n: i + 1 })}
                        onClick={() => setV((p) => ({ ...p, lines: p.lines.length > 1 ? p.lines.filter((x) => x.key !== l.key) : [newPurchaseLine()] }))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={addLine}>
            <Plus /> {ti("addLine")}
          </Button>
          {(data.departments.length > 0 || data.dimensions.length > 0) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowExtra((s) => !s)} disabled={needsExtra}>
              <Columns3 /> {extraVisible ? ti("hideColumns") : t("showDimensions")}
            </Button>
          )}
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            <Kbd>Enter</Kbd> {ti("hintNext")} · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> {ti("hintSave")}
            {canConfirm && mode === "invoice" && (
              <>
                {" "}
                · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> {ti("hintConfirm")}
              </>
            )}
          </span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-5">
            <FormField label={t("notes")} htmlFor="pdoc-notes">
              <Textarea id="pdoc-notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
            </FormField>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1.5 pt-5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{ti("net")}</span>
              <span className="tabular-nums">{formatMoney(calc.net, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{ti("vatTotal")}</span>
              <span className="tabular-nums">{formatMoney(calc.vat, locale)}</span>
            </div>
            {!calc.reverseVat.isZero() && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("reverseVat")}</span>
                <span className="tabular-nums">{formatMoney(calc.reverseVat, locale)}</span>
              </div>
            )}
            {!calc.deductible.equals(calc.vat.plus(calc.reverseVat)) && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("deductibleVat")}</span>
                <span className="tabular-nums">{formatMoney(calc.deductible, locale)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <span>{ti("total")}</span>
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
          {ti("total")}:{" "}
          <b className="tabular-nums">
            {formatMoney(calc.total, locale)}
            {currencyLabel}
          </b>
        </span>
        <Button type="button" variant={mode === "order" ? "default" : "outline"} disabled={pending} onClick={save}>
          {mode === "order" ? tc("save") : ti("saveDraft")}
        </Button>
        {mode === "invoice" && canConfirm && (
          <Button type="button" disabled={pending || !v.supplierId} onClick={confirmDoc}>
            {ti("confirm")}
          </Button>
        )}
      </div>

      {newSupplierOpen && (
        <QuickSupplierDialog
          companyId={companyId}
          baseCurrency={data.baseCurrency}
          initial={newSupplierInitial}
          onClose={() => {
            setNewSupplierOpen(false);
            setNewSupplierInitial(null);
          }}
          onCreated={(s) => {
            setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
            setV((p) => ({ ...p, supplierId: s.id }));
            recomputeDue(v.date, s.id);
            setNewSupplierOpen(false);
          }}
        />
      )}
    </div>
  );

  const sidePanel = side ?? (mode === "invoice" && !documentId ? <PendingFiles files={pendingFiles} onChange={onPendingChange} /> : null);
  if (!sidePanel) return editor;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
      {editor}
      <div className="xl:sticky xl:top-20 xl:self-start">{sidePanel}</div>
    </div>
  );
}

function QuickSupplierDialog({
  companyId,
  baseCurrency,
  initial,
  onClose,
  onCreated,
}: {
  companyId: string;
  baseCurrency: string;
  initial?: SupplierHint | null;
  onClose: () => void;
  onCreated: (s: PurchaseEditorData["suppliers"][number]) => void;
}) {
  const t = useTranslations("suppliers");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState({ name: initial?.name ?? "", regCode: initial?.regCode ?? "", vatNumber: initial?.vatNumber ?? "", bankAccount: initial?.bankAccount ?? "" });
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
                saveSupplier(companyId, {
                  ...v,
                  isPerson: false,
                  countryCode: "EE",
                  addressStreet: "",
                  addressCity: "",
                  addressPostalCode: "",
                  addressCounty: "",
                  email: "",
                  phone: "",
                  contactPerson: "",
                  referenceNumber: "",
                  paymentTermDays: "",
                  currency: baseCurrency,
                  groupId: "",
                  defaultAccountId: "",
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
                    name: d.name,
                    regCode: v.regCode || null,
                    vatNumber: v.vatNumber || null,
                    bankAccount: v.bankAccount || null,
                    paymentTermDays: null,
                    currency: baseCurrency,
                    defaultAccountId: null,
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
            <FormField label={t("name")} htmlFor="qs-name" errors={fieldErrors.name}>
              <Input id="qs-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("regCode")} htmlFor="qs-reg" errors={fieldErrors.regCode}>
                <Input id="qs-reg" value={v.regCode} onChange={(e) => setV({ ...v, regCode: e.target.value })} />
              </FormField>
              <FormField label={t("vatNumber")} htmlFor="qs-vat" errors={fieldErrors.vatNumber}>
                <Input id="qs-vat" value={v.vatNumber} onChange={(e) => setV({ ...v, vatNumber: e.target.value })} />
              </FormField>
            </div>
            <FormField label={t("bankAccount")} htmlFor="qs-iban" errors={fieldErrors.bankAccount}>
              <Input id="qs-iban" value={v.bankAccount} onChange={(e) => setV({ ...v, bankAccount: e.target.value })} placeholder="EE00 0000 0000 0000 0000" />
            </FormField>
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
