"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormError, FormField } from "@/components/common/form-field";
import { useActionRunner } from "@/components/common/use-action";
import { LOCALE_NAMES, LOCALES } from "@/i18n/config";
import { updateCompany } from "@/server/actions/companies";

export type CompanyDetails = {
  name: string;
  regCode: string;
  vatNumber: string;
  addressStreet: string;
  addressCity: string;
  addressCounty: string;
  addressPostalCode: string;
  phone: string;
  email: string;
  website: string;
  documentLocale: "et" | "en" | "fi" | "ru";
};

export function CompanySettingsForm({
  companyId,
  defaultValues,
  readOnly,
}: {
  companyId: string;
  defaultValues: CompanyDetails;
  readOnly: boolean;
}) {
  const t = useTranslations("companies");
  const tc = useTranslations("common");
  const { pending, run } = useActionRunner();
  const [v, setV] = useState(defaultValues);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const field = (key: keyof CompanyDetails, props: React.ComponentProps<typeof Input> = {}) => (
    <Input id={key} value={v[key]} onChange={(e) => setV((p) => ({ ...p, [key]: e.target.value }))} {...props} />
  );

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        run(() => updateCompany(companyId, v), {
          success: tc("saved"),
          onError: (res, msg) => {
            setFieldErrors(res.fieldErrors ?? {});
            if (res.error !== "validation") setError(msg);
          },
        });
      }}
    >
      <FormError message={error} />
      <fieldset disabled={readOnly || pending} className="space-y-6">
        <section className="space-y-4">
          <FormField label={t("name")} htmlFor="name" errors={fieldErrors.name}>
            {field("name")}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("regCode")} htmlFor="regCode" errors={fieldErrors.regCode} hint={t("regCodeHint")}>
              {field("regCode", { inputMode: "numeric" })}
            </FormField>
            <FormField label={t("vatNumber")} htmlFor="vatNumber" errors={fieldErrors.vatNumber} hint={t("vatNumberHint")}>
              {field("vatNumber", { placeholder: "EE100000000" })}
            </FormField>
          </div>
        </section>
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t("address")}</h3>
          <FormField label={t("street")} htmlFor="addressStreet" errors={fieldErrors.addressStreet}>
            {field("addressStreet", { autoComplete: "street-address" })}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={t("city")} htmlFor="addressCity">
              {field("addressCity", { autoComplete: "address-level2" })}
            </FormField>
            <FormField label={t("county")} htmlFor="addressCounty">
              {field("addressCounty", { autoComplete: "address-level1" })}
            </FormField>
            <FormField label={t("postalCode")} htmlFor="addressPostalCode">
              {field("addressPostalCode", { autoComplete: "postal-code", inputMode: "numeric" })}
            </FormField>
          </div>
        </section>
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t("contacts")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={t("phone")} htmlFor="phone">
              {field("phone", { type: "tel", autoComplete: "tel" })}
            </FormField>
            <FormField label={t("email")} htmlFor="email" errors={fieldErrors.email}>
              {field("email", { type: "email", autoComplete: "email" })}
            </FormField>
            <FormField label={t("website")} htmlFor="website">
              {field("website", { autoComplete: "url" })}
            </FormField>
          </div>
          <FormField label={t("documentLocale")} htmlFor="documentLocale" hint={t("documentLocaleHint")}>
            <NativeSelect
              id="documentLocale"
              className="sm:w-60"
              value={v.documentLocale}
              onChange={(e) => setV((p) => ({ ...p, documentLocale: e.target.value as CompanyDetails["documentLocale"] }))}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </section>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      )}
    </form>
  );
}
