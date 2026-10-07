"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, ChevronRight, Menu, Plus, Search } from "lucide-react";
import { isAvailable, visibleQuickActions } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { useMembership, useShell } from "./shell-context";
import { activeNav } from "./nav-utils";

export function Topbar({ onOpenMobileNav, unreadCount }: { onOpenMobileNav: () => void; unreadCount: number }) {
  const t = useTranslations("shell");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const { basePath, openPalette } = useShell();
  const membership = useMembership();
  const pathname = usePathname();
  const active = activeNav(pathname, basePath);
  const actions = visibleQuickActions(membership).filter((a) => a.id !== "newCompany");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-6">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onOpenMobileNav} aria-label={t("openMenu")}>
        <Menu />
      </Button>

      <nav aria-label={t("breadcrumbs")} className="hidden min-w-0 items-center gap-1 text-sm text-muted-foreground sm:flex">
        <Link href={basePath} className="hover:text-foreground">
          {tn("groups.dashboard")}
        </Link>
        {active.groupId && active.groupId !== "dashboard" && (
          <>
            <ChevronRight className="size-3.5 shrink-0" />
            <span>{tn(`groups.${active.groupId}`)}</span>
          </>
        )}
        {active.itemId && (
          <>
            <ChevronRight className="size-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground">{tn(`items.${active.itemId}`)}</span>
          </>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-sm text-muted-foreground shadow-xs hover:bg-muted md:w-64"
          aria-label={t("search")}
        >
          <Search className="size-4" />
          <span className="hidden flex-1 text-left md:inline">{t("searchShort")}</span>
          <span className="hidden items-center gap-0.5 md:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="ml-1 gap-1.5">
                <Plus /> <span className="hidden sm:inline">{t("create")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {actions.map((a) => (
                <DropdownMenuItem key={a.id} asChild>
                  <Link href={`${basePath}${a.href}`}>
                    <a.icon />
                    <span className="flex-1">{tn(`quick.${a.id}`)}</span>
                    {!isAvailable(a.phase) && <span className="text-xs text-muted-foreground">{tc("soon")}</span>}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="ghost" size="icon-sm" asChild className="relative">
          <Link href={`${basePath}#notifications`} aria-label={t("notificationsCount", { count: unreadCount })}>
            <Bell />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white dark:text-stone-900">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
        </Button>
        <div className="hidden sm:flex sm:items-center">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
