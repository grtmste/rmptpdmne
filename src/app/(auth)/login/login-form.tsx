"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/common/form-field";
import { loginWithPassword, requestMagicLink } from "@/server/actions/auth";
import { cn } from "@/lib/utils";

type Mode = "password" | "magic";

export function LoginForm({ callbackUrl, initialError }: { callbackUrl: string; initialError: string | null }) {
  const t = useTranslations("auth");
  const te = useTranslations("errors");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      if (mode === "password") {
        const res = await loginWithPassword({ email, password: String(formData.get("password") ?? ""), callbackUrl });
        if (!res.ok) return setError(te(res.error));
        router.replace(res.data.redirectTo);
        router.refresh();
      } else {
        const res = await requestMagicLink({ email, callbackUrl });
        if (!res.ok) return setError(te(res.error));
        router.push(`/login/check-email?email=${encodeURIComponent(email)}`);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label={t("loginMethod")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["password", KeyRound, t("withPassword")],
            ["magic", Mail, t("withMagicLink")],
          ] as const
        ).map(([m, Icon, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              mode === m && "bg-card text-foreground shadow-sm",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <form action={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />
        <FormField label={t("email")} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </FormField>
        {mode === "password" ? (
          <FormField label={t("password")} htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </FormField>
        ) : (
          <p className="text-sm text-muted-foreground">{t("magicLinkHint")}</p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("pleaseWait") : mode === "password" ? t("login") : t("sendLink")}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {t("register")}
        </Link>
      </p>
    </div>
  );
}
