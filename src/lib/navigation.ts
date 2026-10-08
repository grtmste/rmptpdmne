import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Boxes,
  Building2,
  FileText,
  Landmark,
  LayoutGrid,
  PackageOpen,
  Plus,
  Receipt,
  Settings,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import { can, type Level, type MembershipLike, type Module } from "./permissions";

/**
 * Menüü ainus definitsioon. Seda kasutavad külgmenüü, käsupalett, mobiilimenüü ja
 * „tulekul“ lehed. `href` on suhteline ettevõtte juure (`/c/[companyId]`) suhtes.
 * `phase` – millises tööfaasis vaade valmib (vt CLAUDE.md punkt 8).
 */

/** Faas, mis on hetkel valmis. Kõrgema faasi vaated näitavad „tulekul“ lehte. */
export const CURRENT_PHASE = 1;

export type NavItem = {
  id: string;
  /** next-intl võti nimeruumis `nav` */
  label: string;
  href: string;
  module: Module;
  phase: number;
  /** Lisasõnad käsupaleti otsinguks (nimeruumis `navKeywords`, kui olemas). */
  keywords?: string[];
};

export type NavSection = { label?: string; items: NavItem[] };

export type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  module: Module;
  /** Kui grupil on ainult üks vaade (nt töölaud). */
  href?: string;
  phase?: number;
  sections: NavSection[];
};

const item = (id: string, href: string, module: Module, phase: number, keywords?: string[]): NavItem => ({
  id,
  label: id,
  href,
  module,
  phase,
  keywords,
});

export const NAVIGATION: NavGroup[] = [
  {
    id: "dashboard",
    label: "dashboard",
    icon: LayoutGrid,
    module: "dashboard",
    href: "",
    phase: 0,
    sections: [],
  },
  {
    id: "sales",
    label: "sales",
    icon: TrendingUp,
    module: "sales",
    sections: [
      {
        label: "documents",
        items: [
          item("sales.invoices", "/sales/invoices", "sales", 3),
          item("sales.quotes", "/sales/quotes", "sales", 3),
          item("sales.recurring", "/sales/recurring", "sales", 7),
          item("sales.consolidated", "/sales/consolidated", "sales", 7),
        ],
      },
      {
        label: "registers",
        items: [
          item("sales.customers", "/sales/customers", "sales", 3),
          item("sales.items", "/items", "sales", 3),
        ],
      },
      {
        label: "reports",
        items: [
          item("sales.reportSales", "/sales/reports/sales", "reports", 6),
          item("sales.reportReceivables", "/sales/reports/receivables", "reports", 6),
          item("sales.reportReminders", "/sales/reminders", "sales", 7),
          item("sales.reportInterest", "/sales/interest", "sales", 7),
        ],
      },
    ],
  },
  {
    id: "purchases",
    label: "purchases",
    icon: ShoppingCart,
    module: "purchases",
    sections: [
      {
        label: "documents",
        items: [
          item("purchases.invoices", "/purchases/invoices", "purchases", 4),
          item("purchases.inbox", "/purchases/inbox", "purchases", 4),
          item("purchases.orders", "/purchases/orders", "purchases", 4),
          item("purchases.expenses", "/purchases/expenses", "purchases", 4),
        ],
      },
      {
        label: "registers",
        items: [
          item("purchases.suppliers", "/purchases/suppliers", "purchases", 4),
          item("purchases.employees", "/purchases/employees", "purchases", 4),
        ],
      },
      {
        label: "reports",
        items: [
          item("purchases.reportPurchases", "/purchases/reports/purchases", "reports", 6),
          item("purchases.reportPayables", "/purchases/reports/payables", "reports", 6),
        ],
      },
    ],
  },
  {
    id: "payments",
    label: "payments",
    icon: Banknote,
    module: "payments",
    sections: [
      {
        items: [
          item("payments.list", "/payments", "payments", 5),
          item("payments.statements", "/payments/statements", "payments", 5),
          item("payments.orders", "/payments/orders", "payments", 5),
          item("payments.cashbook", "/payments/cashbook", "payments", 5),
          item("payments.accounts", "/payments/accounts", "payments", 5),
        ],
      },
    ],
  },
  {
    id: "finance",
    label: "finance",
    icon: Landmark,
    module: "finance",
    sections: [
      {
        label: "documents",
        items: [
          item("finance.journal", "/finance/journal", "finance", 2),
          item("finance.vat", "/finance/vat", "finance", 6, ["KMD", "KMD INF"]),
        ],
      },
      {
        label: "reports",
        items: [
          item("finance.ledger", "/finance/ledger", "finance", 2),
          item("finance.trialBalance", "/finance/trial-balance", "finance", 2),
          item("finance.daybook", "/finance/daybook", "finance", 2),
          item("finance.balanceSheet", "/finance/balance-sheet", "reports", 6),
          item("finance.incomeStatement", "/finance/income-statement", "reports", 6),
          item("finance.cashFlow", "/finance/cash-flow", "reports", 6),
        ],
      },
    ],
  },
  {
    id: "inventory",
    label: "inventory",
    icon: Boxes,
    module: "inventory",
    sections: [
      {
        items: [
          item("inventory.movements", "/inventory/movements", "inventory", 8),
          item("inventory.stock", "/inventory/stock", "inventory", 8),
          item("inventory.warehouses", "/inventory/warehouses", "inventory", 8),
        ],
      },
    ],
  },
  {
    id: "assets",
    label: "assets",
    icon: PackageOpen,
    module: "assets",
    sections: [
      {
        items: [
          item("assets.register", "/assets", "assets", 9),
          item("assets.depreciation", "/assets/depreciation", "assets", 9),
        ],
      },
    ],
  },
];

export const SETTINGS_NAVIGATION: NavGroup = {
  id: "settings",
  label: "settings",
  icon: Settings,
  module: "settings",
  sections: [
    {
      label: "company",
      items: [
        item("settings.company", "/settings/company", "settings", 0),
        item("settings.users", "/settings/users", "users", 0),
      ],
    },
    {
      label: "financial",
      items: [
        item("settings.accounts", "/settings/accounts", "settings", 1, ["kontoplaan"]),
        item("settings.vatRates", "/settings/vat-rates", "settings", 1),
        item("settings.fiscalYears", "/settings/fiscal-years", "settings", 1),
        item("settings.numberSeries", "/settings/number-series", "settings", 1),
        item("settings.currencies", "/settings/currencies", "settings", 1),
        item("settings.dimensions", "/settings/dimensions", "settings", 1),
        item("settings.openingBalances", "/settings/opening-balances", "settings", 1),
      ],
    },
  ],
};

export const ALL_GROUPS: NavGroup[] = [...NAVIGATION, SETTINGS_NAVIGATION];

export type QuickAction = {
  id: string;
  label: string;
  href: string;
  module: Module;
  level: Level;
  phase: number;
  icon: LucideIcon;
};

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "newSalesInvoice", label: "newSalesInvoice", href: "/sales/invoices/new", module: "sales", level: "edit", phase: 3, icon: FileText },
  { id: "newPurchaseInvoice", label: "newPurchaseInvoice", href: "/purchases/invoices/new", module: "purchases", level: "edit", phase: 4, icon: Receipt },
  { id: "newPayment", label: "newPayment", href: "/payments/new", module: "payments", level: "edit", phase: 5, icon: Banknote },
  { id: "newJournalEntry", label: "newJournalEntry", href: "/finance/journal/new", module: "finance", level: "edit", phase: 2, icon: Landmark },
  { id: "newCustomer", label: "newCustomer", href: "/sales/customers/new", module: "sales", level: "edit", phase: 3, icon: Users },
  { id: "inviteUser", label: "inviteUser", href: "/settings/users?invite=1", module: "users", level: "confirm", phase: 0, icon: Plus },
  { id: "newCompany", label: "newCompany", href: "/companies/new", module: "dashboard", level: "view", phase: 0, icon: Building2 },
];

/** Grupid ja vaated, mida kasutaja tohib näha. Tühjad grupid jäetakse välja. */
export function visibleNavigation(membership: MembershipLike, groups: NavGroup[] = ALL_GROUPS): NavGroup[] {
  return groups
    .filter((g) => can(membership, g.module, "view"))
    .map((g) => ({
      ...g,
      sections: g.sections
        .map((s) => ({ ...s, items: s.items.filter((i) => can(membership, i.module, "view")) }))
        .filter((s) => s.items.length > 0),
    }))
    .filter((g) => g.href !== undefined || g.sections.length > 0);
}

export function visibleQuickActions(membership: MembershipLike): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => a.id === "newCompany" || can(membership, a.module, a.level));
}

export function flattenNavigation(groups: NavGroup[] = ALL_GROUPS): Array<NavItem & { group: NavGroup }> {
  return groups.flatMap((g) => g.sections.flatMap((s) => s.items.map((i) => ({ ...i, group: g }))));
}

/** Leiab vaate suhtelise tee järgi (kõige pikem prefiks). Kasutab „tulekul“ leht ja leivapuru. */
export function findNavItem(path: string): (NavItem & { group: NavGroup }) | undefined {
  const normalized = "/" + path.replace(/^\/+|\/+$/g, "");
  let best: (NavItem & { group: NavGroup }) | undefined;
  for (const i of flattenNavigation()) {
    if (normalized === i.href || normalized.startsWith(i.href + "/")) {
      if (!best || i.href.length > best.href.length) best = i;
    }
  }
  return best;
}

export function isAvailable(phase: number | undefined): boolean {
  return (phase ?? 0) <= CURRENT_PHASE;
}
