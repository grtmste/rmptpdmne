"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Silt + väli + tõlgitud veateade. `errors` on validation nimeruumi võtmed. */
export function FormField({
  label,
  htmlFor,
  errors,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  errors?: string[];
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("validation");
  const errorId = `${htmlFor}-error`;
  const child = React.isValidElement<Record<string, unknown>>(children)
    ? React.cloneElement(children, {
        "aria-invalid": errors?.length ? true : undefined,
        "aria-describedby": errors?.length ? errorId : undefined,
      })
    : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {child}
      {hint && !errors?.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.length ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {errors.map((e) => (t.has(e) ? t(e) : e)).join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}
