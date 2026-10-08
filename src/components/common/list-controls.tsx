"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Filter = { name: string; label: string; options: Array<{ value: string; label: string }> };

/**
 * Nimekirja otsing ja filtrid URL-i parameetrites (server laeb lehe kaupa). Muutus viib
 * esimesele lehele ja sulgeb eelvaate.
 */
export function ListSearch({
  placeholder,
  filters = [],
  toggles = [],
  dates = false,
}: {
  placeholder: string;
  filters?: Filter[];
  toggles?: Array<{ name: string; label: string }>;
  dates?: boolean;
}) {
  const t = useTranslations("list");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    next.delete("doc");
    const s = next.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`);
  }

  const active = Boolean(sp.get("q") || sp.get("from") || sp.get("to") || filters.some((f) => sp.get(f.name)) || toggles.some((x) => sp.get(x.name)));

  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q: q.trim(), from, to });
      }}
    >
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </div>
      {dates && (
        <>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("from")} />
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("to")} />
        </>
      )}
      {filters.map((f) => (
        <NativeSelect
          key={f.name}
          className="w-44"
          aria-label={f.label}
          value={sp.get(f.name) ?? ""}
          onChange={(e) => apply({ [f.name]: e.target.value })}
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      ))}
      {toggles.map((x) => (
        <Checkbox
          key={x.name}
          className="h-9 items-center"
          label={x.label}
          checked={sp.get(x.name) === "1"}
          onChange={(e) => apply({ [x.name]: e.target.checked ? "1" : "" })}
        />
      ))}
      <Button type="submit" variant="secondary">
        {t("search")}
      </Button>
      {active && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setQ("");
            setFrom("");
            setTo("");
            router.push(pathname);
          }}
        >
          <X /> {t("clear")}
        </Button>
      )}
    </form>
  );
}

/** Lehekülgede vahetus, säilitab muud parameetrid. */
export function Pager({ page, pageSize, total, label }: { page: number; pageSize: number; total: number; label: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const next = new URLSearchParams(sp.toString());
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    const s = next.toString();
    return `${pathname}${s ? `?${s}` : ""}`;
  };
  return (
    <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" asChild disabled={page <= 1}>
          <Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} aria-label="←">
            ←
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild disabled={page >= pages}>
          <Link href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages} aria-label="→">
            →
          </Link>
        </Button>
      </div>
    </div>
  );
}
