"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { updateInvoiceSettings } from "@/server/actions/settings/invoice";

type Values = {
  paymentTermDays: string;
  lateInterestPct: string;
  invoiceBankDetails: string;
  invoiceFooter: string;
  invoiceNote: string;
  invoiceAccent: string;
};

/** Arve aktsentvärvid: oma palett, mis sobib valgel paberil ja trükis. */
const ACCENTS = ["#0f5c55", "#1f6f4a", "#7c4a1e", "#8a3b52", "#3f3d8f", "#334155", "#111827"];

export function InvoiceSettingsForm({ companyId, initial, readOnly }: { companyId: string; initial: Values; readOnly: boolean }) {
  const t = useTranslations("invoiceSettings");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const set = (k: keyof Values, value: string) => setV((p) => ({ ...p, [k]: value }));
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        run(() => updateInvoiceSettings(companyId, v), {
          success: tc("saved"),
          onError: (res, msg) => {
            setFieldErrors(res.fieldErrors ?? {});
            if (res.error !== "validation") setError(msg);
          },
        });
      }}
    >
      <FormError message={error} />
      <fieldset disabled={readOnly || pending} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("paymentTermDays")} htmlFor="s-term" errors={fieldErrors.paymentTermDays} hint={t("paymentTermHint")}>
            <Input id="s-term" inputMode="numeric" value={v.paymentTermDays} onChange={(e) => set("paymentTermDays", e.target.value)} />
          </FormField>
          <FormField label={t("lateInterestPct")} htmlFor="s-interest" errors={fieldErrors.lateInterestPct} hint={t("lateInterestHint")}>
            <Input id="s-interest" inputMode="decimal" value={v.lateInterestPct} onChange={(e) => set("lateInterestPct", e.target.value)} />
          </FormField>
        </div>
        <FormField label={t("bankDetails")} htmlFor="s-bank" errors={fieldErrors.invoiceBankDetails} hint={t("bankDetailsHint")}>
          <Textarea id="s-bank" rows={2} value={v.invoiceBankDetails} onChange={(e) => set("invoiceBankDetails", e.target.value)} placeholder="LHV EE00 7700 7710 0000 0000" />
        </FormField>
        <FormField label={t("note")} htmlFor="s-note" errors={fieldErrors.invoiceNote} hint={t("noteHint")}>
          <Textarea id="s-note" rows={2} value={v.invoiceNote} onChange={(e) => set("invoiceNote", e.target.value)} />
        </FormField>
        <FormField label={t("footer")} htmlFor="s-footer" errors={fieldErrors.invoiceFooter} hint={t("footerHint")}>
          <Input id="s-footer" value={v.invoiceFooter} onChange={(e) => set("invoiceFooter", e.target.value)} />
        </FormField>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t("accent")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("accent")}>
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={v.invoiceAccent === color}
                aria-label={color}
                onClick={() => set("invoiceAccent", color)}
                className={cn("flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-card", v.invoiceAccent === color && "ring-2 ring-ring")}
                style={{ backgroundColor: color }}
              >
                {v.invoiceAccent === color && <Check className="size-4 text-white" />}
              </button>
            ))}
          </div>
        </fieldset>
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
