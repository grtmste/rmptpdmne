"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { countryOptions } from "@/lib/countries";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { deleteCustomer, saveCustomer } from "@/server/actions/customers";

export type CustomerValues = {
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
  emailCc: string;
  phone: string;
  contactPerson: string;
  paymentTermDays: string;
  lateInterestPct: string;
  locale: Locale;
  currency: string;
  referenceNumber: string;
  groupId: string;
  defaultVatRateId: string;
  notes: string;
  active: boolean;
};

export const emptyCustomer = (currency = "EUR", locale: Locale = "et"): CustomerValues => ({
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
  emailCc: "",
  phone: "",
  contactPerson: "",
  paymentTermDays: "",
  lateInterestPct: "",
  locale,
  currency,
  referenceNumber: "",
  groupId: "",
  defaultVatRateId: "",
  notes: "",
  active: true,
});

export function CustomerForm({
  companyId,
  customerId,
  initial,
  groups,
  vatRates,
  currencies,
  defaults,
  canEdit,
}: {
  companyId: string;
  customerId?: string;
  initial: CustomerValues;
  groups: Array<{ id: string; name: string }>;
  vatRates: Array<{ id: string; name: string }>;
  currencies: string[];
  defaults: { paymentTermDays: number; lateInterestPct: string };
  canEdit: boolean;
}) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const set = <K extends keyof CustomerValues>(key: K, value: CustomerValues[K]) => setV((p) => ({ ...p, [key]: value }));
  const text = (key: keyof CustomerValues, props: React.ComponentProps<typeof Input> = {}) => (
    <Input id={`c-${key}`} value={String(v[key])} onChange={(e) => set(key, e.target.value as never)} {...props} />
  );
  const field = (key: keyof CustomerValues, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => (
    <FormField label={label} htmlFor={`c-${key}`} errors={fieldErrors[key]} hint={hint}>
      {text(key, props)}
    </FormField>
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        run(() => saveCustomer(companyId, { ...v, id: customerId }), {
          success: tc("saved"),
          refresh: false,
          onSuccess: (d) => {
            if (!customerId) router.replace(`/c/${companyId}/sales/customers/${d.id}`);
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
            {field("name", t("name"), { autoFocus: !customerId, required: true })}
            <Checkbox label={t("isPerson")} description={t("isPersonHint")} checked={v.isPerson} onChange={(e) => set("isPerson", e.target.checked)} />
            <div className="grid gap-4 sm:grid-cols-3">
              {field("regCode", v.isPerson ? t("personalCode") : t("regCode"), { inputMode: "numeric" })}
              {field("vatNumber", t("vatNumber"), { placeholder: "EE100000000" })}
              <FormField label={t("country")} htmlFor="c-countryCode" errors={fieldErrors.countryCode}>
                <NativeSelect id="c-countryCode" value={v.countryCode} onChange={(e) => set("countryCode", e.target.value)}>
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
            <CardTitle>{t("contacts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {field("email", t("email"), { type: "email", autoComplete: "off" }, t("emailHint"))}
              {field("emailCc", t("emailCc"), { placeholder: "raamatupidamine@firma.ee" }, t("emailCcHint"))}
              {field("phone", t("phone"), { type: "tel" })}
              {field("contactPerson", t("contactPerson"))}
            </div>
            {field("addressStreet", t("street"))}
            <div className="grid gap-4 sm:grid-cols-3">
              {field("addressPostalCode", t("postalCode"))}
              {field("addressCity", t("city"))}
              {field("addressCounty", t("county"))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("invoicing")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {field("paymentTermDays", t("paymentTermDays"), { inputMode: "numeric", placeholder: String(defaults.paymentTermDays) }, t("defaultHint"))}
              {field("lateInterestPct", t("lateInterestPct"), { inputMode: "decimal", placeholder: defaults.lateInterestPct }, t("defaultHint"))}
              {field("referenceNumber", t("referenceNumber"), { inputMode: "numeric" }, t("referenceNumberHint"))}
              <FormField label={t("locale")} htmlFor="c-locale" hint={t("localeHint")}>
                <NativeSelect id="c-locale" value={v.locale} onChange={(e) => set("locale", e.target.value as Locale)}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_NAMES[l]}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("currency")} htmlFor="c-currency">
                <NativeSelect id="c-currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("defaultVat")} htmlFor="c-vat" hint={t("defaultVatHint")}>
                <NativeSelect id="c-vat" value={v.defaultVatRateId} onChange={(e) => set("defaultVatRateId", e.target.value)}>
                  <option value="">{t("byItem")}</option>
                  {vatRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("group")} htmlFor="c-group">
                <NativeSelect id="c-group" value={v.groupId} onChange={(e) => set("groupId", e.target.value)}>
                  <option value="">—</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>
            <FormField label={t("notes")} htmlFor="c-notes" errors={fieldErrors.notes}>
              <Textarea id="c-notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </FormField>
            <Checkbox label={t("active")} description={t("activeHint")} checked={v.active} onChange={(e) => set("active", e.target.checked)} />
          </CardContent>
        </Card>

        {canEdit && (
          <div className="flex flex-wrap justify-between gap-2">
            {customerId ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  confirm(t("deleteConfirm", { name: v.name })) &&
                  run(() => deleteCustomer(companyId, { id: customerId }), {
                    success: t("deleted"),
                    refresh: false,
                    onSuccess: () => router.push(`/c/${companyId}/sales/customers`),
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
