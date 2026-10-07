import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  Circle,
  FileWarning,
  Landmark,
  ReceiptText,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { CURRENT_PHASE } from "@/lib/navigation";
import { daysUntil, nextVatDeadline } from "@/lib/deadlines";
import { formatDate, todayLocal } from "@/lib/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";

export default async function DashboardPage({ params, searchParams }: PageProps<"/c/[companyId]">) {
  const { companyId } = await params;
  const { denied } = await searchParams;
  const ctx = await requireCompany(companyId, "dashboard");
  const t = await getTranslations("dashboard");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const base = `/c/${companyId}`;

  const [memberCount, notifications] = await Promise.all([
    ctx.cdb.membership.count(),
    ctx.cdb.notification.findMany({
      where: { OR: [{ userId: null }, { userId: ctx.user.id }] },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const today = todayLocal();
  const vat = nextVatDeadline(today);
  const vatDays = daysUntil(today, vat.dueDate);

  const checklist = [
    { key: "fiscalYear", href: "/settings/fiscal-years", phase: 1, done: false },
    { key: "accounts", href: "/settings/accounts", phase: 1, done: false },
    { key: "banks", href: "/payments/accounts", phase: 5, done: false },
    { key: "openingBalances", href: "/settings/opening-balances", phase: 1, done: false },
    { key: "users", href: "/settings/users", phase: 0, done: memberCount > 1 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const firstName = ctx.user.name?.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={firstName ? t("greeting", { name: firstName }) : t("title")}
        description={t("subtitle", { company: ctx.company.name })}
      />

      {typeof denied === "string" && (
        <div role="alert" className="mb-6 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <ShieldAlert className="size-4 shrink-0" />
          {t("denied")}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Alustamise juhend */}
        <Card className="lg:col-span-2">
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
                    {item.done ? (
                      <CheckCircle2 className="size-5 shrink-0 text-success" />
                    ) : (
                      <Circle className="size-5 shrink-0 text-muted-foreground/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={item.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>
                        {t(`checklist.${item.key}.title`)}
                      </div>
                      <div className="text-xs text-muted-foreground">{t(`checklist.${item.key}.body`)}</div>
                    </div>
                    {item.phase > CURRENT_PHASE && (
                      <Badge variant="outline">{t("phaseBadge", { phase: item.phase })}</Badge>
                    )}
                    <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Tähtajad */}
        <Card>
          <CardHeader>
            <CardTitle>{t("deadlinesTitle")}</CardTitle>
            <CalendarClock className="size-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{t("vatDeadline")}</div>
                  <div className="text-xs text-muted-foreground">{t("vatPeriod", { period: vat.period })}</div>
                </div>
                <Badge variant={vatDays <= 5 ? "warning" : "default"}>
                  {vatDays === 0 ? t("dueToday") : t("dueInDays", { days: vatDays })}
                </Badge>
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight num text-left">{formatDate(vat.dueDate, locale)}</div>
            </div>
            <p className="text-xs text-muted-foreground">{t("deadlinesNote")}</p>
          </CardContent>
        </Card>

        {/* Finantsvidinad – täituvad järgmistes faasides */}
        {[
          { key: "receivables", icon: ReceiptText, phase: 6, module: "sales" as const },
          { key: "payables", icon: FileWarning, phase: 6, module: "purchases" as const },
          { key: "bank", icon: Wallet, phase: 5, module: "payments" as const },
        ]
          .filter((w) => can(ctx.membership, w.module))
          .map((w) => (
            <Card key={w.key}>
              <CardHeader>
                <CardTitle>{t(`widgets.${w.key}.title`)}</CardTitle>
                <w.icon className="size-5 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex h-28 flex-col items-center justify-center rounded-lg border border-dashed text-center">
                  <p className="text-sm text-muted-foreground">{t(`widgets.${w.key}.empty`)}</p>
                  <Badge variant="outline" className="mt-2">
                    {t("phaseBadge", { phase: w.phase })}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}

        {/* Teated */}
        <Card id="notifications" className="lg:col-span-2">
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

        <Card>
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
              <Link href={`${base}/settings/company`}>{t("companySettingsLink")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
