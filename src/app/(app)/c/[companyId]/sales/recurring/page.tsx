import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, Plus, Repeat, X } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { RecurringActions } from "./recurring-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.recurring") };
}

export default async function RecurringPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/recurring">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("recurring");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const selectedId = typeof sp.doc === "string" ? sp.doc : "";
  const canEdit = can(ctx.membership, "sales", "edit");

  const list = await ctx.cdb.recurringInvoice.findMany({
    orderBy: [{ active: "desc" }, { nextDate: "asc" }, { name: "asc" }],
    include: { lines: { select: { quantity: true, unitPrice: true, discountPct: true } } },
  });
  const customers = new Map(
    (await ctx.cdb.customer.findMany({ where: { id: { in: list.map((r) => r.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
  );
  const net = (r: (typeof list)[number]) =>
    r.lines.reduce((s, l) => s.plus(dec(l.quantity).times(dec(l.unitPrice)).times(dec(100).minus(dec(l.discountPct))).dividedBy(100)), dec(0));
  const selected = list.find((r) => r.id === selectedId) ?? null;
  const detail = selected
    ? await ctx.cdb.recurringInvoice.findFirst({
        where: { id: selected.id },
        include: {
          lines: { orderBy: { sortOrder: "asc" } },
          invoices: { orderBy: { date: "desc" }, take: 12, select: { id: true, number: true, date: true, status: true, total: true, currency: true, sentAt: true } },
        },
      })
    : null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.sales.recurring")}
        description={t("listSubtitle")}
        actions={
          canEdit && (
            <Button asChild>
              <Link href={`/c/${companyId}/sales/recurring/new`}>
                <Plus /> {t("new")}
              </Link>
            </Button>
          )
        }
      />
      {list.length === 0 ? (
        <EmptyState icon={Repeat} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className={cn("grid gap-4", detail && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
          <Card className="overflow-hidden">
            <ul className="divide-y" aria-label={tn("items.sales.recurring")}>
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/c/${companyId}/sales/recurring?doc=${r.id}`}
                    className={cn("flex items-center gap-3 px-4 py-3 hover:bg-muted/40", r.id === selectedId && "bg-muted/60")}
                  >
                    <Repeat className={cn("size-4 shrink-0", r.active ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        {!r.active && <Badge variant="outline">{t("inactive")}</Badge>}
                        <Badge variant="secondary">{t(`intervals.m${r.intervalMonths}`)}</Badge>
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {customers.get(r.customerId)} · {r.nextDate ? t("nextOn", { date: formatDate(r.nextDate, locale) }) : t("ended")}
                      </div>
                    </div>
                    <span className="text-right font-medium tabular-nums">
                      {formatMoney(net(r), locale)} <span className="text-xs text-muted-foreground">{r.currency}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {detail && (
            <Card className="h-fit">
              <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">{detail.name}</h2>
                  <p className="text-sm text-muted-foreground">{customers.get(detail.customerId)}</p>
                </div>
                <Link href={`/c/${companyId}/sales/recurring`} aria-label={t("close")} className="rounded p-1 text-muted-foreground hover:bg-muted">
                  <X className="size-4" />
                </Link>
              </div>
              <div className="space-y-4 px-5 py-4 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("interval")}</dt>
                    <dd>{t(`intervals.m${detail.intervalMonths}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("mode")}</dt>
                    <dd>{t(`modes.${detail.mode}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("startDate")}</dt>
                    <dd>{formatDate(detail.startDate, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("endDate")}</dt>
                    <dd>{detail.endDate ? formatDate(detail.endDate, locale) : "—"}</dd>
                  </div>
                  <div className="col-span-2 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                    <CalendarClock className="size-4 text-primary" />
                    {detail.nextDate ? t("nextOn", { date: formatDate(detail.nextDate, locale) }) : t("ended")}
                    {!detail.active && <Badge variant="outline">{t("inactive")}</Badge>}
                  </div>
                  {detail.lastError && <div className="col-span-2 text-destructive">{detail.lastError}</div>}
                </dl>
                <ul className="divide-y rounded-lg border">
                  {detail.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate">{l.description}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {dec(l.quantity).toString()} × {formatMoney(l.unitPrice, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
                <RecurringActions
                  companyId={companyId}
                  id={detail.id}
                  name={detail.name}
                  canEdit={canEdit}
                  canRun={Boolean(detail.nextDate) && can(ctx.membership, "sales", detail.mode === "DRAFT" ? "edit" : "confirm")}
                />
                <div>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("history")}</h3>
                  {detail.invoices.length === 0 ? (
                    <p className="text-muted-foreground">{t("noInvoices")}</p>
                  ) : (
                    <ul className="space-y-1">
                      {detail.invoices.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2">
                          <Link href={`/c/${companyId}/sales/invoices?doc=${i.id}`} className="font-mono text-primary hover:underline">
                            {i.number ?? t("draft")}
                          </Link>
                          <span className="text-muted-foreground">{formatDate(i.date, locale)}</span>
                          {i.sentAt && <Badge variant="outline">{t("sent")}</Badge>}
                          <span className="ml-auto tabular-nums">
                            {formatMoney(i.total, locale)} {i.currency}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
