"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/common/form-field";
import { register } from "@/server/actions/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

export function RegisterForm({ inviteToken, defaultEmail }: { inviteToken?: string; defaultEmail?: string }) {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await register({
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        organizationName: String(formData.get("organizationName") ?? ""),
        inviteToken,
      });
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        if (res.error !== "validation") setError(te(res.error));
        return;
      }
      router.replace(res.data.redirectTo);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />
      <FormField label={t("name")} htmlFor="name" errors={fieldErrors.name}>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </FormField>
      <FormField label={t("email")} htmlFor="email" errors={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={defaultEmail} required />
      </FormField>
      <FormField
        label={t("password")}
        htmlFor="password"
        errors={fieldErrors.password}
        hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
      </FormField>
      {!inviteToken && (
        <FormField
          label={t("organizationName")}
          htmlFor="organizationName"
          errors={fieldErrors.organizationName}
          hint={t("organizationNameHint")}
        >
          <Input id="organizationName" name="organizationName" autoComplete="organization" />
        </FormField>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("pleaseWait") : t("createAccount")}
      </Button>
    </form>
  );
}
