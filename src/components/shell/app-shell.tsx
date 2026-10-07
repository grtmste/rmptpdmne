"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Banknote, Camera, FileText, Search } from "lucide-react";
import type { PermissionMap } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { setSidebarCollapsed } from "@/server/actions/preferences";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ShellContext, type ShellCompany, type ShellUser, type ShellValue } from "./shell-context";

/** Kiirklahvid: G, seejärel täht. */
export const GOTO_SHORTCUTS: Record<string, string> = {
  d: "",
  m: "/sales/invoices",
  o: "/purchases/invoices",
  p: "/payments",
  f: "/finance/journal",
  s: "/settings/company",
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function AppShell({
  company,
  companies,
  permissions,
  user,
  canCreateCompany,
  initialCollapsed,
  unreadCount,
  children,
}: {
  company: ShellCompany;
  companies: ShellCompany[];
  permissions: PermissionMap;
  user: ShellUser;
  canCreateCompany: boolean;
  initialCollapsed: boolean;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const tn = useTranslations("nav");
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const gPressedAt = useRef(0);
  const basePath = `/c/${company.id}`;

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const value = useMemo<ShellValue>(
    () => ({ company, companies, permissions, role: company.role, user, canCreateCompany, basePath, openPalette }),
    [company, companies, permissions, user, canCreateCompany, basePath, openPalette],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        gPressedAt.current = Date.now();
        return;
      }
      if (Date.now() - gPressedAt.current < 1200 && key in GOTO_SHORTCUTS) {
        gPressedAt.current = 0;
        e.preventDefault();
        router.push(`${basePath}${GOTO_SHORTCUTS[key]}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, basePath]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    void setSidebarCollapsed(next);
  }

  return (
    <ShellContext value={value}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t("skipToContent")}
      </a>
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 transition-[width] duration-200 md:block",
            collapsed ? "w-[68px]" : "w-64",
          )}
        >
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} unreadCount={unreadCount} />
          <main id="main" className="flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-10">
            {children}
          </main>
        </div>
      </div>

      {/* Mobiil: külgmenüü sahtlina */}
      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          className="top-0 left-0 h-dvh w-[85vw] max-w-xs translate-x-0 rounded-none border-0 bg-sidebar p-0"
          closeLabel={t("close")}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{t("mainNavigation")}</DialogTitle>
          <Sidebar collapsed={false} variant="mobile" onNavigate={() => setMobileNavOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Mobiil: kiirtoimingute riba */}
      <nav
        aria-label={t("quickActions")}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {[
          { href: `${basePath}/sales/invoices/new`, icon: FileText, label: tn("quick.newSalesInvoiceShort") },
          { href: `${basePath}/payments/new`, icon: Banknote, label: tn("quick.newPaymentShort") },
          { href: `${basePath}/purchases/inbox?capture=1`, icon: Camera, label: tn("quick.photoShort") },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground hover:text-foreground">
            <a.icon className="size-5" />
            {a.label}
          </Link>
        ))}
        <button type="button" onClick={openPalette} className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground">
          <Search className="size-5" />
          {t("searchShortMobile")}
        </button>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </ShellContext>
  );
}
