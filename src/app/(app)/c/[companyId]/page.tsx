import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  Circle,
  FileText,
  FileWarning,
  Landmark,
  ReceiptText,
  ShieldAlert,
  Sigma,
  Upload,
  Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { CURRENT_PHASE } from "@/lib/navigation";
import { annualReportDeadline, daysUntil, nextVatDeadline } from "@/lib/deadlines";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatIban } from "@/lib/iban";
import { formatMoney } from "@/lib/money";
import { parseISODate } from "@/lib/accounting/dates";
import { bankWidget, debtWidget, type DebtWidget } from "@/server/reports/dashboard";
import { accountTurnoverSummary } from "@/server/reports/financial";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { DashboardGrid, type Widget } from "./_dashboard/dashboard-grid";
import { WeeklyChart } from "./_dashboard/weekly-chart";

type Layout = { order: string[]; hidden: string[] };

function parseLayout(v: unknown): Layout {
  const o = (v ?? {}) as Partial<Layout>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  return { order: list(o.order), hidden: list(o.hidden) };
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/c/[companyId]">) {
  const { companyId } = await params;
  const { denied } = await searchParams;
  const ctx = await requireCompany(companyId, "dashboard");
  const t = await getTranslations("dashboard");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const base = `/c/${companyId}`;
  const today = todayLocal();
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, locale);

  const showSales = can(ctx.membership, "sales");
  const showPurchases = can(ctx.membership, "purchases");
  const showPayments = can(ctx.membership, "payments");
  const showFinance = can(ctx.membership, "finance");

  const [memberCount, fiscalYears, accountCount, openingEntries, bankCount, notifications, membership] = await Promise.all([
    ctx.cdb.membership.count(),
    ctx.cdb.fiscalYear.findMany({ orderBy: { startDate: "asc" }, select: { endDate: true, closedAt: true } }),
    ctx.cdb.glAccount.count(),
    ctx.cdb.journalEntry.count({ where: { source: "OPENING_BALANCE" } }),
    ctx.cdb.bankAccount.count({ where: { iban: { not: null } } }),
    ctx.cdb.notification.findMany({
      where: { OR: [{ userId: null }, { userId: ctx.user.id }] },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.membership.findUnique({ where: { id: ctx.membership.id }, select: { dashboard: true } }),
  ]);
  const [receivables, payables, unconfirmed, banks, turnover] = await Promise.all([
    showSales ? debtWidget(db, companyId, "receivables", today) : null,
    showPurchases ? debtWidget(db, companyId, "payables", today) : null,
    showPurchases ? ctx.cdb.purchaseInvoice.count({ where: { status: "DRAFT", source: "UPLOAD" } }) : 0,
    showPayments ? bankWidget(db, companyId) : [],
    showFinance ? accountTurnoverSummary(db, companyId, today) : [],
  ]);

  const vat = nextVatDeadline(today);
  const vatDays = daysUntil(today, vat.dueDate);
  // Esimese sulgemata majandusaasta aruande tähtaeg
  const openYear = fiscalYears.find((y) => !y.closedAt && y.endDate.getTime() < today.getTime());
  const annual = openYear ? annualReportDeadline(openYear.endDate) : null;

  const checklist = [
    { key: "fiscalYear", href: "/settings/fiscal-years", phase: 1, done: fiscalYears.length > 0 },
    { key: "accounts", href: "/settings/accounts", phase: 1, done: accountCount > 0 },
    { key: "banks", href: "/payments/accounts", phase: 5, done: bankCount > 0 },
    { key: "openingBalances", href: "/settings/opening-balances", phase: 1, done: openingEntries > 0 },
    { key: "users", href: "/settings/users", phase: 0, done: memberCount > 1 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const firstName = ctx.user.name?.split(" ")[0] ?? "";

  const weekLabel = (bucket: string, from: string | null) => {
    if (bucket === "older") return t("weeks.older");
    if (bucket === "later") return t("weeks.later");
    if (bucket === "w0") return t("weeks.current");
    const d = parseISODate(from ?? "")!;
    return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
  };
  const debtCard = (kind: "receivables" | "payables", w: DebtWidget, extra?: React.ReactNode) => {
    const href = kind === "receivables" ? `${base}/sales/reports/receivables?detail=1` : `${base}/purchases/reports/payables?detail=1`;
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t(`widgets.${kind}.title`)}</CardTitle>
          {kind === "receivables" ? <ReceiptText className="size-5 text-muted-foreground" /> : <FileWarning className="size-5 text-muted-foreground" />}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold tracking-tight tabular-nums" data-testid={`${kind}-total`}>
                {m(w.total)}
              </div>
              <div className="text-xs text-muted-foreground">{t("openCount", { count: w.count })}</div>
            </div>
            {!w.overdue.isZero() && (
              <div className="text-right">
                <div className="font-semibold text-warning tabular-nums">{m(w.overdue)}</div>
                <div className="text-xs text-muted-foreground">{t("overdueCount", { count: w.overdueCount })}</div>
              </div>
            )}
          </div>
          {w.count === 0 ? (
            <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">{t(`widgets.${kind}.none`)}</p>
          ) : (
            <WeeklyChart
              locale={locale}
              ariaLabel={t("chartLabel")}
              data={w.weeks.map((x) => ({
                bucket: x.bucket,
                label: weekLabel(x.bucket, x.from),
                amount: Number(x.amount),
                past: x.bucket === "older" || x.bucket.startsWith("w-"),
                href,
              }))}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {extra}
            <Button variant="link" size="sm" className="ml-auto px-0" asChild>
              <Link href={href}>{t("openReport")} →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const widgets: Widget[] = [];
  widgets.push({
    id: "checklist",
    title: t("checklistTitle"),
    wide: true,
    node: (
      <Card className="h-full">
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>{t("checklistTitle")}</CardTitle>
            <CardDescription>{t("checklistBody")}</CardDescription>
          </div>
          <Badge variant="secondary" className="num">
            {doneCount}/{checklist.length}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
          </div>
          <ol className="divide-y">
            {checklist.map((item) => (
              <li key={item.key}>
                <Link href={`${base}${item.href}`} className="group flex items-center gap-3 py-3">
                  {item.done ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className="size-5 shrink-0 text-muted-foreground/60" />}
                  <div className="min-w-0 flex-1">
                    <div className={item.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>{t(`checklist.${item.key}.title`)}</div>
                    <div className="text-xs text-muted-foreground">{t(`checklist.${item.key}.body`)}</div>
                  </div>
                  {item.phase > CURRENT_PHASE && <Badge variant="outline">{t("phaseBadge", { phase: item.phase })}</Badge>}
                  <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    ),
  });
  widgets.push({
    id: "deadlines",
    title: t("deadlinesTitle"),
    node: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t("deadlinesTitle")}</CardTitle>
          <CalendarClock className="size-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{t("vatDeadline")}</div>
                <div className="text-xs text-muted-foreground">{t("vatPeriod", { period: vat.period })}</div>
              </div>
              <Badge variant={vatDays <= 5 ? "warning" : "default"}>{vatDays === 0 ? t("dueToday") : t("dueInDays", { days: vatDays })}</Badge>
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatDate(vat.dueDate, locale)}</span>
              {showFinance && (
                <Link href={`${base}/finance/vat?period=${vat.period}`} className="text-xs text-primary hover:underline">
                  {t("openVat")} →
                </Link>
              )}
            </div>
          </div>
          {annual && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{t("annualReport")}</div>
                  <div className="text-xs text-muted-foreground">{t("annualReportYear", { date: formatDate(openYear!.endDate, locale) })}</div>
                </div>
                <Badge variant={daysUntil(today, annual) <= 30 ? "warning" : "default"}>
                  {daysUntil(today, annual) < 0 ? t("overdue") : t("dueInDays", { days: daysUntil(today, annual) })}
                </Badge>
              </div>
              <div className="mt-3 text-xl font-semibold tracking-tight tabular-nums">{formatDate(annual, locale)}</div>
            </div>
          )}
        </CardContent>
      </Card>
    ),
  });
  if (receivables) widgets.push({ id: "receivables", title: t("widgets.receivables.title"), node: debtCard("receivables", receivables) });
  if (payables)
    widgets.push({
      id: "payables",
      title: t("widgets.payables.title"),
      node: debtCard(
        "payables",
        payables,
        unconfirmed > 0 ? (
          <Link href={`${base}/purchases/inbox`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Upload className="size-3.5" /> {t("unconfirmed", { count: unconfirmed })}
          </Link>
        ) : undefined,
      ),
    });
  if (showPayments)
    widgets.push({
      id: "banks",
      title: t("widgets.bank.title"),
      node: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t("widgets.bank.title")}</CardTitle>
            <Wallet className="size-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {banks.length === 0 ? (
              <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">{t("widgets.bank.empty")}</p>
            ) : (
              <ul className="divide-y">
                {banks.map((b) => (
                  <li key={b.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{b.name}</span>
                      <span className="font-semibold tabular-nums" data-testid="bank-balance">
                        {m(b.balance)}
                      </span>
                    </div>
                    {b.iban && <div className="font-mono text-xs text-muted-foreground">{formatIban(b.iban)}</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={`${base}/payments/statements`}>{t("importStatement")}</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`${base}/payments/orders`}>{t("paymentOrders")}</Link>
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href={`${base}/payments`}>{tn("items.payments.list")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ),
    });
  if (showFinance)
    widgets.push({
      id: "accounts",
      title: t("widgets.accounts.title"),
      node: (
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t("widgets.accounts.title")}</CardTitle>
            <Sigma className="size-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {turnover.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {t("widgets.accounts.empty")}{" "}
                <Link href={`${base}/settings/accounts`} className="text-primary hover:underline">
                  {t("widgets.accounts.choose")}
                </Link>
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-1 text-left font-medium" />
                    <th className="pb-1 text-right font-medium">{t("thisMonth")}</th>
                    <th className="pb-1 text-right font-medium">{t("yearToDate")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {turnover.map((a) => (
                    <tr key={a.id}>
                      <td className="py-1.5 pr-2">
                        <Link href={`${base}/finance/ledger?account=${a.id}`} className="hover:text-primary hover:underline">
                          <span className="font-mono text-xs">{a.code}</span> {a.name}
                        </Link>
                      </td>
                      <td className="num py-1.5">{m(a.month)}</td>
                      <td className="num py-1.5 font-medium">{m(a.year)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ),
    });
  widgets.push({
    id: "notifications",
    title: t("notificationsTitle"),
    wide: true,
    node: (
      <Card id="notifications" className="h-full">
        <CardHeader>
          <CardTitle>{t("notificationsTitle")}</CardTitle>
          <Bell className="size-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noNotifications")}</p>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => (
                <li key={n.id} className="flex items-start gap-3 py-3">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-muted-foreground/30" : "bg-primary"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-sm text-muted-foreground">{n.body}</div>}
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.createdAt.toISOString()}>
                    {formatDate(n.createdAt, locale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    ),
  });
  widgets.push({
    id: "shortcuts",
    title: t("shortcutsTitle"),
    node: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{t("shortcutsTitle")}</CardTitle>
          <Landmark className="size-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t("shortcutsBody")}</p>
          <ul className="space-y-1.5">
            {(
              [
                ["Ctrl K", t("shortcutPalette")],
                ["G D", tn("groups.dashboard")],
                ["G M", tn("items.sales.invoices")],
                ["G O", tn("items.purchases.invoices")],
                ["G P", tn("groups.payments")],
                ["G S", tn("groups.settings")],
              ] as const
            ).map(([keys, label]) => (
              <li key={keys} className="flex items-center justify-between gap-2">
                <span>{label}</span>
                <span className="flex gap-1">
                  {keys.split(" ").map((k) => (
                    <kbd key={k} className="rounded border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
                      {k}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <Button variant="link" size="sm" asChild>
            <Link href={`${base}/settings/company`}>
              <FileText /> {t("companySettingsLink")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    ),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={firstName ? t("greeting", { name: firstName }) : t("title")} description={t("subtitle", { company: ctx.company.name })} />
      {typeof denied === "string" && (
        <div role="alert" className="mb-6 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <ShieldAlert className="size-4 shrink-0" />
          {t("denied")}
        </div>
      )}
      <DashboardGrid companyId={companyId} widgets={widgets} layout={parseLayout(membership?.dashboard)} />
    </div>
  );
}
