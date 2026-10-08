"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { countryOptions } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteSupplier, saveSupplier } from "@/server/actions/suppliers";

export type SupplierValues = {
  name: string;
  isPerson: boolean;
  regCode: string;
  vatNumber: string;
  countryCode: string;
  addressStreet: string;
  addressCity: string;
  addressPostalCode: string;
  addressCounty: string;
  email: string;
  phone: string;
  contactPerson: string;
  bankAccount: string;
  referenceNumber: string;
  paymentTermDays: string;
  currency: string;
  groupId: string;
  defaultAccountId: string;
  defaultVatRateId: string;
  notes: string;
  active: boolean;
};

export const emptySupplier = (currency = "EUR"): SupplierValues => ({
  name: "",
  isPerson: false,
  regCode: "",
  vatNumber: "",
  countryCode: "EE",
  addressStreet: "",
  addressCity: "",
  addressPostalCode: "",
  addressCounty: "",
  email: "",
  phone: "",
  contactPerson: "",
  bankAccount: "",
  referenceNumber: "",
  paymentTermDays: "",
  currency,
  groupId: "",
  defaultAccountId: "",
  defaultVatRateId: "",
  notes: "",
  active: true,
});

export function SupplierForm({
  companyId,
  supplierId,
  initial,
  groups,
  vatRates,
  accounts,
  currencies,
  paymentTermDays,
  canEdit,
}: {
  companyId: string;
  supplierId?: string;
  initial: SupplierValues;
  groups: Array<{ id: string; name: string }>;
  vatRates: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; label: string }>;
  currencies: string[];
  paymentTermDays: number;
  canEdit: boolean;
}) {
  const t = useTranslations("suppliers");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const set = <K extends keyof SupplierValues>(k: K, value: SupplierValues[K]) => setV((p) => ({ ...p, [k]: value }));
  const field = (k: keyof SupplierValues, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => (
    <FormField label={label} htmlFor={`s-${k}`} errors={fieldErrors[k]} hint={hint}>
      <Input id={`s-${k}`} value={String(v[k])} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </FormField>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        run(() => saveSupplier(companyId, { ...v, id: supplierId }), {
          success: tc("saved"),
          refresh: false,
          onSuccess: (d) => {
            if (!supplierId) router.replace(`/c/${companyId}/purchases/suppliers/${d.id}`);
            else router.refresh();
          },
          onError: (res, msg) => {
            setFieldErrors(res.fieldErrors ?? {});
            setError(res.error === "validation" ? t("fixErrors") : msg);
          },
        });
      }}
    >
      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <FormError message={error} />
        <Card>
          <CardHeader>
            <CardTitle>{t("basics")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {field("name", t("name"), { autoFocus: !supplierId })}
            <Checkbox label={t("isPerson")} checked={v.isPerson} onChange={(e) => set("isPerson", e.target.checked)} />
            <div className="grid gap-4 sm:grid-cols-3">
              {field("regCode", t("regCode"), { inputMode: "numeric" })}
              {field("vatNumber", t("vatNumber"), { placeholder: "EE100000000" })}
              <FormField label={t("country")} htmlFor="s-countryCode">
                <NativeSelect id="s-countryCode" value={v.countryCode} onChange={(e) => set("countryCode", e.target.value)}>
                  {countryOptions(locale).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("payments")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("bankAccount", t("bankAccount"), { placeholder: "EE00 0000 0000 0000 0000" }, t("bankAccountHint"))}
              {field("referenceNumber", t("referenceNumber"), { inputMode: "numeric" }, t("referenceNumberHint"))}
              {field("paymentTermDays", t("paymentTermDays"), { inputMode: "numeric", placeholder: String(paymentTermDays) }, t("defaultHint"))}
              <FormField label={t("currency")} htmlFor="s-currency">
                <NativeSelect id="s-currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("defaultAccount")} htmlFor="s-account" hint={t("defaultAccountHint")}>
                <Combobox
                  options={accounts.map((a) => ({ value: a.id, label: a.label }))}
                  value={v.defaultAccountId}
                  onChange={(id) => set("defaultAccountId", id)}
                  placeholder={t("accountPlaceholder")}
                  aria-label={t("defaultAccount")}
                  ref={(el) => {
                    if (el) el.id = "s-account";
                  }}
                />
              </FormField>
              <FormField label={t("defaultVat")} htmlFor="s-vat" hint={t("defaultVatHint")}>
                <NativeSelect id="s-vat" value={v.defaultVatRateId} onChange={(e) => set("defaultVatRateId", e.target.value)}>
                  <option value="">—</option>
                  {vatRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("contacts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {field("email", t("email"), { type: "email" })}
              {field("phone", t("phone"), { type: "tel" })}
              {field("contactPerson", t("contactPerson"))}
            </div>
            {field("addressStreet", t("street"))}
            <div className="grid gap-4 sm:grid-cols-3">
              {field("addressPostalCode", t("postalCode"))}
              {field("addressCity", t("city"))}
              {field("addressCounty", t("county"))}
            </div>
            <FormField label={t("group")} htmlFor="s-group">
              <NativeSelect id="s-group" value={v.groupId} onChange={(e) => set("groupId", e.target.value)}>
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={t("notes")} htmlFor="s-notes">
              <Textarea id="s-notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
            </FormField>
            <Checkbox label={t("active")} checked={v.active} onChange={(e) => set("active", e.target.checked)} />
          </CardContent>
        </Card>
        {canEdit && (
          <div className="flex flex-wrap justify-between gap-2">
            {supplierId ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  confirm(t("deleteConfirm", { name: v.name })) &&
                  run(() => deleteSupplier(companyId, { id: supplierId }), {
                    success: t("deleted"),
                    refresh: false,
                    onSuccess: () => router.push(`/c/${companyId}/purchases/suppliers`),
                  })
                }
              >
                <Trash2 /> {t("delete")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
