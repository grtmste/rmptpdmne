import * as React from "react";
import { cn } from "@/lib/utils";

/** Märkeruut koos sildiga. Brauseri oma input – töötab klaviatuuriga ja vormidega. */
export function Checkbox({
  label,
  description,
  className,
  id,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode; description?: React.ReactNode }) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-2.5 text-sm", className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-input accent-[var(--primary)]"
        {...props}
      />
      <span className="space-y-0.5">
        <span className="block leading-tight">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
