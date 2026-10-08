"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Filters = { from: string; to: string; status: string; source: string; q: string };

/** Kannete filtrid URL-i parameetritena (lehekülgede vahetamine ja jagamine töötavad). */
export function JournalFilters({ initial, sources }: { initial: Filters; sources: string[] }) {
  const t = useTranslations("journal");
  const router = useRouter();
  const pathname = usePathname();
  const active = Object.values(initial).some(Boolean);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const sp = new URLSearchParams();
        for (const [k, v] of data.entries()) if (typeof v === "string" && v) sp.set(k, v);
        router.push(`${pathname}${sp.size ? `?${sp}` : ""}`);
      }}
    >
      <div className="relative w-full sm:w-64">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={initial.q} placeholder={t("search")} aria-label={t("search")} className="pl-8" />
      </div>
      <Input name="from" type="date" defaultValue={initial.from} aria-label={t("from")} className="w-40" />
      <Input name="to" type="date" defaultValue={initial.to} aria-label={t("to")} className="w-40" />
      <NativeSelect name="status" defaultValue={initial.status} aria-label={t("status")} className="w-36">
        <option value="">{t("allStatuses")}</option>
        <option value="POSTED">{t("statusPosted")}</option>
        <option value="DRAFT">{t("statusDraft")}</option>
      </NativeSelect>
      <NativeSelect name="source" defaultValue={initial.source} aria-label={t("source")} className="w-48">
        <option value="">{t("allSources")}</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {t(`sources.${s}`)}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="secondary">
        {t("filter")}
      </Button>
      {active && (
        <Button type="button" variant="ghost" onClick={() => router.push(pathname)}>
          <X /> {t("clearFilters")}
        </Button>
      )}
    </form>
  );
}
