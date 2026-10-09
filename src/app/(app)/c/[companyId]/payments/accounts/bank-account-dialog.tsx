"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteBankAccount, saveBankAccount } from "@/server/actions/payments";

type Values = { kind: "BANK" | "CASH"; name: string; iban: string; bic: string; currency: string; accountId: string; showOnInvoice: boolean; active: boolean };

export function BankAccountDialog({
  companyId,
  accountId,
  initial,
  glAccounts,
}: {
  companyId: string;
  accountId?: string;
  initial?: Values;
  glAccounts: Array<{ id: string; label: string }>;
}) {
  const t = useTranslations("bankAccounts");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const empty: Values = { kind: "BANK", name: "", iban: "", bic: "", currency: "EUR", accountId: glAccounts.find((g) => g.label.startsWith("1020"))?.id ?? "", showOnInvoice: true, active: true };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>(initial ?? empty);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setV(initial ?? empty);
          setError(null);
          setFieldErrors({});
        }
      }}
    >
      {accountId ? (
        <Button variant="ghost" size="icon-sm" aria-label={t("editNamed", { name: initial?.name ?? "" })} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> {t("new")}
        </Button>
      )}
      <DialogContent closeLabel={tc("close")} aria-describedby={undefined}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setFieldErrors({});
            run(() => saveBankAccount(companyId, { ...v, id: accountId }), {
              success: tc("saved"),
              onSuccess: () => setOpen(false),
              onError: (res, msg) => {
                setFieldErrors(res.fieldErrors ?? {});
                if (res.error !== "validation") setError(msg);
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{accountId ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <FormField label={t("kind")} htmlFor="ba-kind">
                <NativeSelect id="ba-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Values["kind"] })}>
                  <option value="BANK">{t("kinds.BANK")}</option>
                  <option value="CASH">{t("kinds.CASH")}</option>
                </NativeSelect>
              </FormField>
              <FormField label={t("name")} htmlFor="ba-name" errors={fieldErrors.name}>
                <Input id="ba-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
              </FormField>
            </div>
            {v.kind === "BANK" && (
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <FormField label="IBAN" htmlFor="ba-iban" errors={fieldErrors.iban}>
                  <Input id="ba-iban" value={v.iban} onChange={(e) => setV({ ...v, iban: e.target.value })} placeholder="EE00 0000 0000 0000 0000" />
                </FormField>
                <FormField label="BIC" htmlFor="ba-bic" errors={fieldErrors.bic}>
                  <Input id="ba-bic" value={v.bic} onChange={(e) => setV({ ...v, bic: e.target.value.toUpperCase() })} placeholder="LHVBEE22" />
                </FormField>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <FormField label={t("glAccount")} htmlFor="ba-gl" hint={t("glAccountHint")}>
                <NativeSelect id="ba-gl" value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
                  <option value="">—</option>
                  {glAccounts.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("currency")} htmlFor="ba-cur" errors={fieldErrors.currency}>
                <Input id="ba-cur" value={v.currency} maxLength={3} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
              </FormField>
            </div>
            {v.kind === "BANK" && <Checkbox label={t("showOnInvoice")} description={t("showOnInvoiceHint")} checked={v.showOnInvoice} onChange={(e) => setV({ ...v, showOnInvoice: e.target.checked })} />}
            <Checkbox label={t("active")} checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          </DialogBody>
          <DialogFooter className="justify-between">
            {accountId ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() => confirm(t("deleteConfirm", { name: v.name })) && run(() => deleteBankAccount(companyId, { id: accountId }), { onSuccess: () => setOpen(false) })}
              >
                <Trash2 /> {t("delete")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !v.name.trim() || !v.accountId}>
                {tc("save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
