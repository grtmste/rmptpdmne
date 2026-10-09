"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type ReportBarField =
  | { key: string; label: string; type: "date" }
  | { key: string; label: string; type: "select"; options: Array<{ value: string; label: string }> }
  | { key: string; label: string; type: "search" }
  | { key: string; label: string; type: "check" };

/**
 * Müügi-, ostu- ja võlgnevusaruannete filtririba. Väljad on URL-is (jagatav link);
 * `dependsOn` peidab välja, kui teise välja väärtus ei sobi (nt „alates“ ainult käibeandmikus).
 */
export function ReportBar({
  fields,
  initial,
  exportHref,
  visibleWhen = {},
}: {
  fields: ReportBarField[];
  initial: Record<string, string>;
  exportHref?: string;
  visibleWhen?: Record<string, { key: string; values: string[] }>;
}) {
  const t = useTranslations("reports");
  const router = useRouter();
  const pathname = usePathname();
  const [v, setV] = useState(initial);
  const shown = (key: string) => {
    const rule = visibleWhen[key];
    return !rule || rule.values.includes(v[rule.key] ?? "");
  };

  function apply() {
    const sp = new URLSearchParams();
    for (const f of fields) if (shown(f.key) && v[f.key]) sp.set(f.key, v[f.key]!);
    router.push(`${pathname}?${sp}`);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      {fields.filter((f) => shown(f.key)).map((f) => {
        const id = `rb-${f.key}`;
        if (f.type === "check")
          return (
            <Checkbox
              key={f.key}
              label={f.label}
              checked={v[f.key] === "1"}
              onChange={(e) => setV({ ...v, [f.key]: e.target.checked ? "1" : "" })}
              className="pb-2"
            />
          );
        return (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={id}>{f.label}</Label>
            {f.type === "date" ? (
              <Input id={id} type="date" value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="w-40" />
            ) : f.type === "select" ? (
              <NativeSelect id={id} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="w-48">
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input id={id} type="search" value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="w-56" />
            )}
          </div>
        );
      })}
      <Button type="submit">{t("show")}</Button>
      <div className="ml-auto flex gap-2">
        {exportHref && (
          <Button type="button" variant="outline" asChild>
            <a href={exportHref} download>
              <Download /> CSV
            </a>
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => window.print()}>
          <Printer /> {t("print")}
        </Button>
      </div>
    </form>
  );
}
