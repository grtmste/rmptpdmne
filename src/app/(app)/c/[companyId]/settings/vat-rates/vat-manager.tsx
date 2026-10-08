"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { parseISODate } from "@/lib/accounting/dates";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteVatRate, saveVatRate } from "@/server/actions/settings/vat";

const KINDS = ["TAXABLE", "ZERO_EXPORT", "ZERO_EU_GOODS", "EU_SERVICES", "EXEMPT", "REVERSE_CHARGE", "NOT_TAXABLE", "MARGIN"] as const;
type Kind = (typeof KINDS)[number];
type Period = { rate: string; validFrom: string; validTo: string };

export type VatRow = {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  kind: Kind;
  deductiblePct: string;
  invoiceNote: string;
  salesAccountId: string;
  purchaseAccountId: string;
  active: boolean;
  used: boolean;
  currentRate: string | null;
  periods: Period[];
};

type AccountOption = { id: string; code: string; name: string };

export function VatManager({
  companyId,
  rates,
  accounts,
  canEdit,
}: {
  companyId: string;
  rates: VatRow[];
  accounts: AccountOption[];
  canEdit: boolean;
}) {
  const t = useTranslations("vat");
  const locale = useLocale();
  const [editing, setEditing] = useState<VatRow | "new" | null>(null);
  const fmt = (iso: string) => formatDate(parseISODate(iso)!, locale);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("explain")}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> {t("add")}
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <TH className="w-24">{t("code")}</TH>
              <TH>{t("name")}</TH>
              <TH className="w-20 text-right">{t("current")}</TH>
              <TH className="hidden md:table-cell">{t("kind")}</TH>
              <TH className="hidden lg:table-cell">{t("history")}</TH>
            </tr>
          </THead>
          <TBody>
            {rates.map((r) => (
              <TR
                key={r.id}
                className={cn("cursor-pointer", !r.active && "opacity-55")}
                tabIndex={0}
                onClick={() => setEditing(r)}
                onKeyDown={(e) => e.key === "Enter" && setEditing(r)}
              >
                <TD className="font-mono text-[13px]">{r.code}</TD>
                <TD>
                  {r.name}
                  {!r.active && (
                    <Badge variant="outline" className="ml-2">
                      {t("inactive")}
                    </Badge>
                  )}
                </TD>
                <TD className="num font-medium">{r.currentRate !== null ? `${r.currentRate}%` : "—"}</TD>
                <TD className="hidden text-muted-foreground md:table-cell">{t(`kinds.${r.kind}`)}</TD>
                <TD className="hidden text-xs text-muted-foreground lg:table-cell">
                  {r.periods.length > 1
                    ? r.periods.map((p) => `${p.rate}% ${t("from")} ${fmt(p.validFrom)}`).join(" · ")
                    : t("sinceAlways", { rate: r.periods[0]?.rate ?? "0" })}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {editing && (
        <VatDialog
          companyId={companyId}
          rate={editing === "new" ? null : editing}
          accounts={accounts}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function VatDialog({
  companyId,
  rate,
  accounts,
  canEdit,
  onClose,
}: {
  companyId: string;
  rate: VatRow | null;
  accounts: AccountOption[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("vat");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [v, setV] = useState(
    rate ?? {
      code: "",
      name: "",
      nameEn: "",
      kind: "TAXABLE" as Kind,
      deductiblePct: "100",
      invoiceNote: "",
      salesAccountId: "",
      purchaseAccountId: "",
      active: true,
      periods: [{ rate: "", validFrom: "", validTo: "" }],
    },
  );
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [key]: value }));
  const setPeriod = (i: number, patch: Partial<Period>) =>
    set(
      "periods",
      v.periods.map((p, k) => (k === i ? { ...p, ...patch } : p)),
    );

  function submit() {
    setError(null);
    setFieldErrors({});
    run(
      () =>
        saveVatRate(companyId, {
          id: rate?.id,
          code: v.code,
          name: v.name,
          nameEn: v.nameEn,
          kind: v.kind,
          deductiblePct: v.deductiblePct,
          invoiceNote: v.invoiceNote,
          salesAccountId: v.salesAccountId,
          purchaseAccountId: v.purchaseAccountId,
          active: v.active,
          periods: v.periods,
        }),
      {
        success: tc("saved"),
        onSuccess: onClose,
        onError: (res, msg) => {
          setFieldErrors(res.fieldErrors ?? {});
          setError(res.error === "validation" ? null : msg);
        },
      },
    );
  }

  const accountOptions = (
    <>
      <option value="">—</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} {a.name}
        </option>
      ))}
    </>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{rate ? rate.name : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto">
            <FormError message={error} />
            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
                <FormField label={t("code")} htmlFor="code" errors={fieldErrors.code}>
                  <Input id="code" value={v.code} onChange={(e) => set("code", e.target.value)} autoFocus={!rate} />
                </FormField>
                <FormField label={t("name")} htmlFor="name" errors={fieldErrors.name}>
                  <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} />
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("kind")} htmlFor="kind" hint={t(`kindHints.${v.kind}`)}>
                  <NativeSelect id="kind" value={v.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`kinds.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label={t("deductible")} htmlFor="deductible" errors={fieldErrors.deductiblePct} hint={t("deductibleHint")}>
                  <Input id="deductible" inputMode="decimal" value={v.deductiblePct} onChange={(e) => set("deductiblePct", e.target.value)} />
                </FormField>
              </div>
              <FormField label={t("invoiceNote")} htmlFor="note" hint={t("invoiceNoteHint")}>
                <Input id="note" value={v.invoiceNote} onChange={(e) => set("invoiceNote", e.target.value)} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("salesAccount")} htmlFor="sales">
                  <NativeSelect id="sales" value={v.salesAccountId} onChange={(e) => set("salesAccountId", e.target.value)}>
                    {accountOptions}
                  </NativeSelect>
                </FormField>
                <FormField label={t("purchaseAccount")} htmlFor="purchase">
                  <NativeSelect id="purchase" value={v.purchaseAccountId} onChange={(e) => set("purchaseAccountId", e.target.value)}>
                    {accountOptions}
                  </NativeSelect>
                </FormField>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{t("periods")}</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => set("periods", [...v.periods, { rate: "", validFrom: "", validTo: "" }])}
                  >
                    <Plus /> {t("addPeriod")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("periodsHint")}</p>
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="grid grid-cols-[90px_1fr_1fr_32px] gap-2 text-xs text-muted-foreground">
                    <span>{t("rate")}</span>
                    <span>{t("validFrom")}</span>
                    <span>{t("validTo")}</span>
                  </div>
                  {v.periods.map((p, i) => (
                    <div key={i} className="grid grid-cols-[90px_1fr_1fr_32px] gap-2">
                      <Input
                        aria-label={t("rate")}
                        inputMode="decimal"
                        value={p.rate}
                        onChange={(e) => setPeriod(i, { rate: e.target.value })}
                        aria-invalid={fieldErrors[`periods.${i}.rate`] ? true : undefined}
                      />
                      <Input
                        type="date"
                        aria-label={t("validFrom")}
                        value={p.validFrom}
                        onChange={(e) => setPeriod(i, { validFrom: e.target.value })}
                        aria-invalid={fieldErrors[`periods.${i}.validFrom`] ? true : undefined}
                      />
                      <Input type="date" aria-label={t("validTo")} value={p.validTo} onChange={(e) => setPeriod(i, { validTo: e.target.value })} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={tc("delete")}
                        disabled={v.periods.length === 1}
                        onClick={() =>
                          set(
                            "periods",
                            v.periods.filter((_, k) => k !== i),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <Checkbox label={t("active")} checked={v.active} onChange={(e) => set("active", e.target.checked)} />
            </fieldset>
          </DialogBody>
          <DialogFooter className="justify-between">
            <div>
              {rate && canEdit && !rate.used && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(t("deleteConfirm", { name: rate.name }))) {
                      run(() => deleteVatRate(companyId, { id: rate.id }), { success: t("deleted"), onSuccess: onClose });
                    }
                  }}
                >
                  {tc("delete")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {canEdit ? tc("cancel") : tc("close")}
              </Button>
              {canEdit && (
                <Button type="submit" disabled={pending}>
                  {pending ? tc("saving") : tc("save")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
