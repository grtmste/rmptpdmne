"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";

/** Aruannete ühine filtririba. Filtrid on URL-is, nii et aruannet saab jagada ja uuesti avada. */
export function ReportFilters({
  initial,
  options,
  exportHref,
  showAccount,
  showZero,
}: {
  initial: { from: string; to: string; account: string; department: string; dimension: string; zero: boolean };
  options: { accounts: ComboOption[]; departments: ComboOption[]; dimensionValues: ComboOption[] };
  exportHref: string;
  showAccount?: boolean;
  showZero?: boolean;
}) {
  const t = useTranslations("reports");
  const router = useRouter();
  const pathname = usePathname();
  const [v, setV] = useState(initial);

  function apply(next = v) {
    const sp = new URLSearchParams();
    if (next.from) sp.set("from", next.from);
    if (next.to) sp.set("to", next.to);
    if (next.account) sp.set("account", next.account);
    if (next.department) sp.set("department", next.department);
    if (next.dimension) sp.set("dimension", next.dimension);
    if (next.zero) sp.set("zero", "1");
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
      <div className="space-y-1.5">
        <Label htmlFor="r-from">{t("from")}</Label>
        <Input id="r-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} className="w-40" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="r-to">{t("to")}</Label>
        <Input id="r-to" type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} className="w-40" />
      </div>
      {showAccount && (
        <div className="w-72 space-y-1.5">
          <Label>{t("account")}</Label>
          <Combobox
            options={options.accounts}
            value={v.account}
            onChange={(account) => setV({ ...v, account })}
            placeholder={t("allAccounts")}
            aria-label={t("account")}
          />
        </div>
      )}
      {options.departments.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="r-dep">{t("department")}</Label>
          <NativeSelect id="r-dep" value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })} className="w-48">
            <option value="">{t("all")}</option>
            {options.departments.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {options.dimensionValues.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="r-dim">{t("dimension")}</Label>
          <NativeSelect id="r-dim" value={v.dimension} onChange={(e) => setV({ ...v, dimension: e.target.value })} className="w-56">
            <option value="">{t("all")}</option>
            {options.dimensionValues.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {showZero && (
        <Checkbox label={t("includeZero")} checked={v.zero} onChange={(e) => setV({ ...v, zero: e.target.checked })} className="pb-2" />
      )}
      <Button type="submit">{t("show")}</Button>
      <div className="ml-auto flex gap-2">
        <Button type="button" variant="outline" asChild>
          <a href={exportHref} download>
            <Download /> CSV
          </a>
        </Button>
        <Button type="button" variant="ghost" onClick={() => window.print()}>
          <Printer /> {t("print")}
        </Button>
      </div>
    </form>
  );
}
