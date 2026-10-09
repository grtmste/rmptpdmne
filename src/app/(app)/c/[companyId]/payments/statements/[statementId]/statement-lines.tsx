"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCheck, EyeOff, RefreshCw, Trash2, Undo2, Wand2 } from "lucide-react";
import { parseISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatIban } from "@/lib/iban";
import { dec, formatMoney, parseMoneyInput, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import {
  confirmAllSuggestions,
  confirmStatementLineAction,
  deleteStatement,
  ignoreStatementLineAction,
  loadOpenItems,
  rematchStatement,
} from "@/server/actions/payments";
import type { OpenItemView, PaymentFormData } from "../../payment-form";

type Suggestion =
  | { kind: "allocations"; partyType: string; partyId: string; partyName: string; reason: string; allocations: Array<{ type: string; id: string | null; number: string | null; amount: string }> }
  | { kind: "payment"; paymentId: string; number: string | null; reason: string }
  | { kind: "account"; accountId: string; accountCode: string; reason: string };

export type LineView = {
  id: string;
  date: string;
  amount: string;
  partyName: string | null;
  partyIban: string | null;
  referenceNumber: string | null;
  description: string | null;
  status: "NEW" | "SUGGESTED" | "DONE" | "IGNORED";
  suggestion: Suggestion | null;
  payment: { id: string; number: string | null } | null;
};

export function StatementLines({
  companyId,
  statementId,
  lines,
  canConfirm,
  canEdit,
  data,
}: {
  companyId: string;
  statementId: string;
  lines: LineView[];
  canConfirm: boolean;
  canEdit: boolean;
  data: PaymentFormData;
}) {
  const t = useTranslations("statements");
  const tp = useTranslations("payments");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [resolving, setResolving] = useState<LineView | null>(null);
  const suggested = lines.filter((l) => l.status === "SUGGESTED").length;
  const done = lines.filter((l) => l.status === "DONE").length;
  const totals = {
    in: sum(lines.filter((l) => dec(l.amount).isPositive()).map((l) => l.amount)),
    out: sum(lines.filter((l) => dec(l.amount).isNegative()).map((l) => l.amount)),
  };

  const describe = (s: Suggestion) => {
    if (s.kind === "payment") return t("suggestPayment", { number: s.number ?? "" });
    if (s.kind === "account") return t("suggestAccount", { code: s.accountCode });
    const docs = s.allocations.filter((a) => a.number).map((a) => a.number).join(", ");
    const prepay = s.allocations.find((a) => a.type === "PREPAYMENT");
    return [s.partyName, docs ? t("suggestDocs", { docs }) : null, prepay ? t("suggestPrepayment", { amount: formatMoney(prepay.amount, locale) }) : null]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {t("progress", { done, total: lines.length })} · {t("inTotal")} <b className="text-foreground tabular-nums">{formatMoney(totals.in, locale)}</b> · {t("outTotal")}{" "}
          <b className="text-foreground tabular-nums">{formatMoney(totals.out.abs(), locale)}</b>
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => rematchStatement(companyId, { statementId }), { success: t("rematched") })}>
              <RefreshCw /> {t("rematch")}
            </Button>
          )}
          {canConfirm && suggested > 0 && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => confirmAllSuggestions(companyId, { statementId }), {
                  onSuccess: (d) => (d.failed ? toast.warning(t("confirmedSome", d)) : toast.success(t("confirmedAll", { count: d.confirmed }))),
                })
              }
            >
              <CheckCheck /> {t("confirmAll", { count: suggested })}
            </Button>
          )}
          {canEdit && done === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                confirm(t("deleteConfirm")) &&
                run(() => deleteStatement(companyId, { statementId }), { success: t("deleted"), refresh: false, onSuccess: () => router.push(`/c/${companyId}/payments/statements`) })
              }
            >
              <Trash2 /> {t("delete")}
            </Button>
          )}
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-24 px-4 py-2 text-left font-medium">{t("date")}</th>
                <th className="px-2 py-2 text-left font-medium">{t("party")}</th>
                <th className="w-28 px-2 py-2 text-right font-medium">{t("amount")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("match")}</th>
                <th className="w-44 px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l) => {
                const amount = dec(l.amount);
                return (
                  <tr key={l.id} className={cn("align-top", l.status === "IGNORED" && "opacity-50")}>
                    <td className="px-4 py-2 text-muted-foreground tabular-nums">{formatDate(parseISODate(l.date)!, locale)}</td>
                    <td className="px-2 py-2">
                      <div className="font-medium">{l.partyName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {[l.partyIban ? formatIban(l.partyIban) : null, l.referenceNumber ? `${t("ref")} ${l.referenceNumber}` : null, l.description].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className={cn("px-2 py-2 text-right font-medium tabular-nums", amount.isPositive() ? "text-success" : "")}>{formatMoney(l.amount, locale)}</td>
                    <td className="px-3 py-2">
                      {l.status === "DONE" && l.payment ? (
                        <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={`/c/${companyId}/payments?doc=${l.payment.id}`}>
                          <Check className="size-3.5" /> {tp("paymentNo", { number: l.payment.number ?? "" })}
                        </Link>
                      ) : l.status === "SUGGESTED" && l.suggestion ? (
                        <span className="flex items-start gap-1.5">
                          <Wand2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          <span>
                            {describe(l.suggestion)}
                            <Badge variant="outline" className="ml-1.5">
                              {t(`reasons.${l.suggestion.reason}`)}
                            </Badge>
                          </span>
                        </span>
                      ) : l.status === "IGNORED" ? (
                        <span className="text-muted-foreground">{t("ignored")}</span>
                      ) : (
                        <span className="text-muted-foreground">{t("noMatch")}</span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {l.status !== "DONE" && (
                        <div className="flex justify-end gap-1">
                          {l.status === "SUGGESTED" && canConfirm && (
                            <Button size="sm" disabled={pending} onClick={() => run(() => confirmStatementLineAction(companyId, { lineId: l.id, resolution: { kind: "suggestion" } }), { success: t("lineConfirmed") })}>
                              <Check /> {t("confirm")}
                            </Button>
                          )}
                          {canConfirm && l.status !== "IGNORED" && (
                            <Button size="sm" variant="outline" onClick={() => setResolving(l)}>
                              {t("resolve")}
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={l.status === "IGNORED" ? t("restore") : t("ignore")}
                              title={l.status === "IGNORED" ? t("restore") : t("ignore")}
                              onClick={() => run(() => ignoreStatementLineAction(companyId, { lineId: l.id, ignore: l.status !== "IGNORED" }))}
                            >
                              {l.status === "IGNORED" ? <Undo2 /> : <EyeOff />}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {resolving && <ResolveDialog companyId={companyId} line={resolving} data={data} onClose={() => setResolving(null)} />}
    </div>
  );
}

const num = (s: string) => (s.trim() === "" ? dec(0) : (parseMoneyInput(s) ?? null));

/** Käsitsi sobitamine: arved osapoolelt (jääk ettemaksuks) või otse kontole. */
function ResolveDialog({ companyId, line, data, onClose }: { companyId: string; line: LineView; data: PaymentFormData; onClose: () => void }) {
  const t = useTranslations("statements");
  const tp = useTranslations("payments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { pending, run } = useActionRunner();
  const amount = dec(line.amount);
  const incoming = amount.isPositive();
  const [mode, setMode] = useState<"documents" | "account">("documents");
  const [partyType, setPartyType] = useState<"CUSTOMER" | "SUPPLIER" | "EMPLOYEE">(incoming ? "CUSTOMER" : "SUPPLIER");
  const [partyId, setPartyId] = useState("");
  const [items, setItems] = useState<OpenItemView[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState(line.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const parties = partyType === "CUSTOMER" ? data.customers : partyType === "SUPPLIER" ? data.suppliers : data.employees;
  const docType: "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT" = partyType === "CUSTOMER" ? "SALES_INVOICE" : partyType === "SUPPLIER" ? "PURCHASE_INVOICE" : "EXPENSE_REPORT";
  const accountOptions = useMemo(() => data.accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), [data.accounts]);

  function chooseParty(id: string) {
    setPartyId(id);
    setPicked({});
    if (!id) return setItems([]);
    loadOpenItems(companyId, {
      types: [docType],
      customerId: partyType === "CUSTOMER" ? id : "",
      supplierId: partyType === "SUPPLIER" ? id : "",
      employeeId: partyType === "EMPLOYEE" ? id : "",
    }).then((res) => setItems(res.ok ? res.data : []));
  }

  const allocatedDocs = sum(Object.values(picked).map((v) => num(v) ?? dec(0)));
  const remainder = amount.abs().minus(allocatedDocs);
  const canPrepay = partyType !== "EMPLOYEE";

  function submit() {
    setError(null);
    const allocations =
      mode === "account"
        ? [{ type: "ACCOUNT" as const, accountId, amount: amount.abs().toFixed(2), description, salesInvoiceId: "", purchaseInvoiceId: "", expenseReportId: "" }]
        : [
            ...Object.entries(picked).map(([id, v]) => ({
              type: docType,
              salesInvoiceId: docType === "SALES_INVOICE" ? id : "",
              purchaseInvoiceId: docType === "PURCHASE_INVOICE" ? id : "",
              expenseReportId: docType === "EXPENSE_REPORT" ? id : "",
              accountId: "",
              amount: v,
              description: "",
            })),
            ...(remainder.isPositive() && canPrepay
              ? [{ type: "PREPAYMENT" as const, amount: remainder.toFixed(2), accountId: "", salesInvoiceId: "", purchaseInvoiceId: "", expenseReportId: "", description: "" }]
              : []),
          ];
    run(
      () =>
        confirmStatementLineAction(companyId, {
          lineId: line.id,
          resolution: { kind: "manual", partyType: mode === "account" ? "OTHER" : partyType, partyId: mode === "account" ? "" : partyId, description, allocations },
        }),
      { success: t("lineConfirmed"), onSuccess: onClose, onError: (_, msg) => setError(msg) },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {t("resolveTitle")} · {formatMoney(line.amount, locale)}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">{[line.partyName, line.description].filter(Boolean).join(" · ")}</p>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === "documents" ? "default" : "outline"} onClick={() => setMode("documents")}>
              {t("modeDocuments")}
            </Button>
            <Button type="button" size="sm" variant={mode === "account" ? "default" : "outline"} onClick={() => setMode("account")}>
              {t("modeAccount")}
            </Button>
          </div>
          {mode === "documents" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <FormField label={tp("partyType")} htmlFor="rs-type">
                  <NativeSelect
                    id="rs-type"
                    value={partyType}
                    onChange={(e) => {
                      setPartyType(e.target.value as typeof partyType);
                      setPartyId("");
                      setItems([]);
                      setPicked({});
                    }}
                  >
                    {(["CUSTOMER", "SUPPLIER", "EMPLOYEE"] as const).map((p) => (
                      <option key={p} value={p}>
                        {tp(`partyTypes.${p}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label={tp("party")} htmlFor="rs-party">
                  <Combobox options={parties.map((p) => ({ value: p.id, label: p.name }))} value={partyId} onChange={chooseParty} aria-label={tp("party")} placeholder={tp("partyPlaceholder")} />
                </FormField>
              </div>
              {items.length > 0 && (
                <ul className="divide-y rounded-lg border text-sm">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-1.5">
                      <Checkbox
                        label={
                          <span>
                            <span className="font-mono">{i.number}</span> <span className="text-muted-foreground">{i.invoiceNumber ?? ""}</span>
                          </span>
                        }
                        checked={i.id in picked}
                        onChange={(e) =>
                          setPicked((p) => {
                            const next = { ...p };
                            if (e.target.checked) next[i.id] = (dec(i.open).lessThan(remainder.plus(dec(p[i.id] ?? 0))) ? dec(i.open) : remainder.isPositive() ? remainder : dec(i.open)).toFixed(2);
                            else delete next[i.id];
                            return next;
                          })
                        }
                      />
                      <span className="ml-auto text-muted-foreground tabular-nums">{formatMoney(i.open, locale)}</span>
                      {i.id in picked && (
                        <Input className="h-8 w-28 text-right tabular-nums" aria-label={`${tp("allocate")} ${i.number}`} value={picked[i.id]} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.value })} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className={cn("text-sm", remainder.isNegative() ? "text-destructive" : "text-muted-foreground")}>
                {remainder.isZero() ? t("fullyAllocated") : canPrepay && remainder.isPositive() ? t("remainderPrepayment", { amount: formatMoney(remainder, locale) }) : t("remainder", { amount: formatMoney(remainder, locale) })}
              </p>
            </>
          ) : (
            <FormField label={tp("account")} htmlFor="rs-account" hint={t("accountHint")}>
              <Combobox options={accountOptions} value={accountId} onChange={setAccountId} aria-label={tp("account")} />
            </FormField>
          )}
          <FormField label={tp("description")} htmlFor="rs-desc">
            <Input id="rs-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending || (mode === "account" ? !accountId : !partyId || remainder.isNegative() || (!canPrepay && !remainder.isZero()))}
            onClick={submit}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
