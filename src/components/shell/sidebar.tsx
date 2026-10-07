"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { isAvailable, NAVIGATION, SETTINGS_NAVIGATION, visibleNavigation, type NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompanySwitcher } from "./company-switcher";
import { useMembership, useShell } from "./shell-context";
import { activeNav } from "./nav-utils";

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  variant = "desktop",
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  variant?: "desktop" | "mobile";
}) {
  const t = useTranslations("shell");
  const membership = useMembership();
  const { basePath } = useShell();
  const pathname = usePathname();
  const active = activeNav(pathname, basePath);
  const main = visibleNavigation(membership, NAVIGATION);
  const settings = visibleNavigation(membership, [SETTINGS_NAVIGATION]);

  return (
    <nav
      aria-label={t("mainNavigation")}
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground",
        variant === "desktop" && "border-r border-sidebar-border",
      )}
    >
      <div className={cn("p-3", collapsed && "px-2")}>
        <CompanySwitcher collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 [scrollbar-width:thin]" data-collapsed={collapsed}>
        {main.map((group) => (
          <NavGroupEntry
            key={group.id}
            group={group}
            collapsed={collapsed}
            active={active}
            basePath={basePath}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <div className="space-y-0.5 border-t border-sidebar-border px-3 py-3">
        {settings.map((group) => (
          <NavGroupEntry
            key={group.id}
            group={group}
            collapsed={collapsed}
            active={active}
            basePath={basePath}
            onNavigate={onNavigate}
          />
        ))}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={collapsed ? t("expand") : t("collapse")}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            {!collapsed && <span>{t("collapse")}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}

const rowClass =
  "group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

function NavGroupEntry({
  group,
  collapsed,
  active,
  basePath,
  onNavigate,
}: {
  group: NavGroup;
  collapsed: boolean;
  active: { itemId: string | null; groupId: string };
  basePath: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const isActiveGroup = active.groupId === group.id;
  const [open, setOpen] = useState(isActiveGroup);
  const Icon = group.icon;
  const label = t(`groups.${group.id}`);

  if (group.href !== undefined) {
    return (
      <Tooltip content={label} disabled={!collapsed}>
        <Link
          href={`${basePath}${group.href}`}
          onClick={onNavigate}
          aria-current={isActiveGroup ? "page" : undefined}
          className={cn(rowClass, isActiveGroup && "bg-sidebar-accent text-sidebar-accent-foreground", collapsed && "justify-center px-0")}
        >
          <Icon className={cn("size-[18px] shrink-0", isActiveGroup ? "text-sidebar-primary" : "text-sidebar-muted")} />
          {!collapsed && <span className="truncate">{label}</span>}
        </Link>
      </Tooltip>
    );
  }

  const items = <GroupItems group={group} active={active} basePath={basePath} onNavigate={onNavigate} />;

  if (collapsed) {
    return (
      <Popover>
        <Tooltip content={label}>
          <PopoverTrigger
            className={cn(rowClass, "justify-center px-0", isActiveGroup && "bg-sidebar-accent text-sidebar-accent-foreground")}
            aria-label={label}
          >
            <Icon className={cn("size-[18px]", isActiveGroup ? "text-sidebar-primary" : "text-sidebar-muted")} />
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent side="right" align="start" className="w-64 bg-sidebar p-2 text-sidebar-foreground">
          <div className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-sidebar-muted uppercase">{label}</div>
          {items}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(rowClass, isActiveGroup && !open && "bg-sidebar-accent text-sidebar-accent-foreground")}
      >
        <Icon className={cn("size-[18px] shrink-0", isActiveGroup ? "text-sidebar-primary" : "text-sidebar-muted")} />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn("size-4 text-sidebar-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="mt-0.5 mb-2 ml-[1.15rem] border-l border-sidebar-border pl-3">{items}</div>}
    </div>
  );
}

function GroupItems({
  group,
  active,
  basePath,
  onNavigate,
}: {
  group: NavGroup;
  active: { itemId: string | null };
  basePath: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  return (
    <div className="space-y-2">
      {group.sections.map((section, i) => (
        <div key={section.label ?? i}>
          {section.label && (
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-sidebar-muted/80 uppercase">
              {t(`sections.${section.label}`)}
            </div>
          )}
          <ul>
            {section.items.map((item) => {
              const isActive = active.itemId === item.id;
              const available = isAvailable(item.phase);
              return (
                <li key={item.id}>
                  <Link
                    href={`${basePath}${item.href}`}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                      !available && "text-sidebar-foreground/60",
                    )}
                  >
                    {isActive && <span className="absolute top-1.5 bottom-1.5 -left-[13px] w-0.5 rounded bg-sidebar-primary" aria-hidden />}
                    <span className="truncate">{t(`items.${item.id}`)}</span>
                    {!available && (
                      <span className="shrink-0 rounded-sm border border-sidebar-border px-1 text-[10px] text-sidebar-muted">
                        {tc("soon")}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
