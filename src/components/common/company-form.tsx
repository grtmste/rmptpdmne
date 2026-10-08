"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/common/form-field";
import type { ActionResult } from "@/lib/action";

export type CompanyFormValues = { name: string; regCode: string; vatNumber: string; accountingStartDate?: string };

/** Ettevõtte põhiandmete vorm (lisamine ja muutmine). */
export function CompanyForm({
  defaultValues,
  submitLabel,
  onSubmit,
  onSuccess,
  readOnly,
  withStartDate,
}: {
  defaultValues?: Partial<CompanyFormValues>;
  submitLabel: string;
  onSubmit: (values: CompanyFormValues) => Promise<ActionResult<unknown>>;
  onSuccess?: (data: unknown) => void;
  readOnly?: boolean;
  /** Uue ettevõtte puhul küsitakse ka arvestuse alguse kuupäeva */
  withStartDate?: boolean;
}) {
  const t = useTranslations("companies");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    const values: CompanyFormValues = {
      name: String(formData.get("name") ?? ""),
      regCode: String(formData.get("regCode") ?? ""),
      vatNumber: String(formData.get("vatNumber") ?? ""),
      ...(withStartDate ? { accountingStartDate: String(formData.get("accountingStartDate") ?? "") } : {}),
    };
    startTransition(async () => {
      const res = await onSubmit(values);
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        if (res.error !== "validation") setError(te(res.error));
        return;
      }
      toast.success(tc("saved"));
      onSuccess?.(res.data);
    });
  }

  return (
    <form action={submit} className="space-y-4" noValidate>
      <FormError message={error} />
      <fieldset disabled={readOnly || pending} className="space-y-4">
        <FormField label={t("name")} htmlFor="name" errors={fieldErrors.name}>
          <Input id="name" name="name" defaultValue={defaultValues?.name} required autoFocus={!defaultValues?.name} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("regCode")} htmlFor="regCode" errors={fieldErrors.regCode} hint={t("regCodeHint")}>
            <Input id="regCode" name="regCode" defaultValue={defaultValues?.regCode} inputMode="numeric" />
          </FormField>
          <FormField label={t("vatNumber")} htmlFor="vatNumber" errors={fieldErrors.vatNumber} hint={t("vatNumberHint")}>
            <Input id="vatNumber" name="vatNumber" defaultValue={defaultValues?.vatNumber} placeholder="EE100000000" />
          </FormField>
        </div>
        {withStartDate && (
          <FormField
            label={t("accountingStart")}
            htmlFor="accountingStartDate"
            errors={fieldErrors.accountingStartDate}
            hint={t("accountingStartHint")}
            className="sm:w-1/2"
          >
            <Input
              id="accountingStartDate"
              name="accountingStartDate"
              type="date"
              defaultValue={`${new Date().getFullYear()}-01-01`}
            />
          </FormField>
        )}
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
