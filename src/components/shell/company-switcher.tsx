"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Check, ChevronsUpDown, LayoutList, Plus } from "lucide-react";
import { findNavItem } from "@/lib/navigation";
import { cn, initials } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useShell, type ShellCompany } from "./shell-context";

const RECENT_COUNT = 5;

/** Teise ettevõttesse vahetades jääme samasse moodulisse (aga mitte konkreetse dokumendi lehele). */
export function switchTarget(pathname: string, currentBase: string, companyId: string): string {
  const rel = pathname.startsWith(currentBase) ? pathname.slice(currentBase.length) : "";
  const item = rel ? findNavItem(rel) : undefined;
  return `/c/${companyId}${item?.href ?? ""}`;
}

export function CompanySwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const t = useTranslations("shell");
  const tr = useTranslations("roles");
  const { company, companies, basePath, canCreateCompany } = useShell();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const recent = companies.slice(0, RECENT_COUNT);
  const rest = [...companies.slice(RECENT_COUNT)].sort((a, b) => a.name.localeCompare(b.name));

  function go(href: string) {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  }

  const renderItem = (c: ShellCompany) => (
    <CommandItem
      key={c.id}
      value={`${c.name} ${c.regCode ?? ""} ${c.id}`}
      onSelect={() => go(switchTarget(pathname, basePath, c.id))}
    >
      <CompanyAvatar name={c.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[c.regCode, tr(c.role)].filter(Boolean).join(" · ")}
        </div>
      </div>
      {c.id === company.id && <Check className="text-primary!" />}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent",
          collapsed && "justify-center",
        )}
        aria-label={t("switchCompany")}
      >
        <CompanyAvatar name={company.name} className="bg-sidebar-primary text-sidebar" />
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{company.name}</div>
              <div className="truncate text-xs text-sidebar-muted">{company.regCode ?? tr(company.role)}</div>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" side={collapsed ? "right" : "bottom"}>
        <Command>
          <CommandInput placeholder={t("searchCompanies")} />
          <CommandList>
            <CommandEmpty>{t("noCompanies")}</CommandEmpty>
            <CommandGroup heading={t("recentCompanies")}>{recent.map(renderItem)}</CommandGroup>
            {rest.length > 0 && <CommandGroup heading={t("otherCompanies")}>{rest.map(renderItem)}</CommandGroup>}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__all" onSelect={() => go("/companies")}>
                <LayoutList /> {t("allCompanies")}
              </CommandItem>
              {canCreateCompany && (
                <CommandItem value="__new" onSelect={() => go("/companies/new")}>
                  <Plus /> {t("addCompany")}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-foreground",
        className,
      )}
      aria-hidden
    >
      {initials(name.replace(/\b(OÜ|AS|MTÜ|FIE|TÜ|SA)\b/g, "").trim() || name) || <Building2 className="size-4" />}
    </span>
  );
}
