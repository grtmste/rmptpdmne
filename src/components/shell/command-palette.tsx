"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { ArrowRight, Building2, LayoutGrid, Moon, Sun, UserRound } from "lucide-react";
import {
  ALL_GROUPS,
  flattenNavigation,
  isAvailable,
  visibleNavigation,
  visibleQuickActions,
} from "@/lib/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
} from "@/components/ui/command";
import { searchCompanyData } from "@/server/actions/search";
import type { SearchResult } from "@/server/search/registry";
import { useMembership, useShell } from "./shell-context";
import { CompanyAvatar } from "./company-switcher";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("palette");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const ts = useTranslations("shell");
  const membership = useMembership();
  const { basePath, company, companies } = useShell();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();

  const navItems = useMemo(() => flattenNavigation(visibleNavigation(membership, ALL_GROUPS)), [membership]);
  const actions = useMemo(() => visibleQuickActions(membership), [membership]);

  // Andmeotsing serverist (debounce 200 ms).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        const res = await searchCompanyData(company.id, { query: q });
        setResults(res.ok ? res.data : []);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, company.id]);

  // Lühikese päringu korral vanu tulemusi ei näidata.
  const visibleResults = query.trim().length >= 2 ? results : [];

  function handleOpenChange(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  function go(href: string) {
    handleOpenChange(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0" hideClose aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <Command loop>
          <CommandInput placeholder={t("placeholder")} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{searching ? t("searching") : t("empty")}</CommandEmpty>

            {visibleResults.length > 0 && (
              <CommandGroup heading={t("results")}>
                {visibleResults.map((r) => (
                  <CommandItem key={`${r.kind}:${r.id}`} value={`result ${r.kind} ${r.title} ${r.subtitle ?? ""} ${r.id}`} onSelect={() => go(`${basePath}${r.href}`)}>
                    <UserRound />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.title}</div>
                      {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                    </div>
                    <span className="text-xs text-muted-foreground">{t(`kinds.${r.kind}`)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading={t("actions")}>
              {actions.map((a) => {
                const available = isAvailable(a.phase);
                const href = a.href.startsWith("/companies") ? a.href : `${basePath}${a.href}`;
                return (
                  <CommandItem key={a.id} value={`action ${tn(`quick.${a.id}`)}`} onSelect={() => go(href)}>
                    <a.icon />
                    <span className="flex-1">{tn(`quick.${a.id}`)}</span>
                    {!available && <span className="text-xs text-muted-foreground">{tc("soon")}</span>}
                  </CommandItem>
                );
              })}
              <CommandItem value={`theme ${ts("themeLight")}`} onSelect={() => { setTheme("light"); handleOpenChange(false); }}>
                <Sun /> {ts("themeLight")}
              </CommandItem>
              <CommandItem value={`theme ${ts("themeDark")}`} onSelect={() => { setTheme("dark"); handleOpenChange(false); }}>
                <Moon /> {ts("themeDark")}
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading={t("navigation")}>
              <CommandItem value={`nav ${tn("groups.dashboard")}`} onSelect={() => go(basePath)}>
                <LayoutGrid />
                <span className="flex-1">{tn("groups.dashboard")}</span>
              </CommandItem>
              {navItems.map((item) => {
                const Icon = item.group.icon;
                const label = tn(`items.${item.id}`);
                const groupLabel = tn(`groups.${item.group.id}`);
                return (
                  <CommandItem
                    key={item.id}
                    value={`nav ${label} ${groupLabel} ${(item.keywords ?? []).join(" ")}`}
                    onSelect={() => go(`${basePath}${item.href}`)}
                  >
                    <Icon />
                    <span className="flex-1">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {isAvailable(item.phase) ? groupLabel : tc("soon")}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {companies.length > 1 && (
              <CommandGroup heading={t("companies")}>
                {companies
                  .filter((c) => c.id !== company.id)
                  .map((c) => (
                    <CommandItem key={c.id} value={`company ${c.name} ${c.regCode ?? ""}`} onSelect={() => go(`/c/${c.id}`)}>
                      <CompanyAvatar name={c.name} className="size-6 text-[10px]" />
                      <span className="flex-1">{c.name}</span>
                      <Building2 />
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> {t("hintMove")}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> {t("hintOpen")}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> {t("hintClose")}
            </span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <Kbd>G</Kbd>
              <ArrowRight className="size-3" />
              <Kbd>M</Kbd> {t("hintGoto")}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
