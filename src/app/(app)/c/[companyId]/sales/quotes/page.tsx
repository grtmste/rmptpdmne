import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileSignature, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { emailDefaults } from "@/server/sales/email-defaults";
import { QuotePreview, type QuotePreviewData } from "./quote-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.quotes") };
}

const PAGE_SIZE = 50;
const STATUSES = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "INVOICED"] as const;

export default async function QuotesPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/quotes">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("quotes");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const status = (STATUSES as readonly string[]).includes(str(sp.status)) ? (str(sp.status) as (typeof STATUSES)[number]) : null;
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);

  const where: Prisma.QuoteWhereInput = {
    ...(status ? { status } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, quotes] = await Promise.all([
    ctx.cdb.quote.count({ where }),
    ctx.cdb.quote.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);

  let preview: QuotePreviewData | null = null;
  if (selectedId) {
    const quote = await ctx.cdb.quote.findFirst({ where: { id: selectedId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    if (quote) {
      const [vatRates, invoice, emails, customer] = await Promise.all([
        ctx.cdb.vatRate.findMany({ where: { id: { in: quote.lines.map((l) => l.vatRateId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
        quote.invoiceId ? ctx.cdb.salesInvoice.findFirst({ where: { id: quote.invoiceId }, select: { id: true, number: true } }) : null,
        ctx.cdb.emailLog.findMany({ where: { documentType: "Quote", documentId: quote.id }, orderBy: { createdAt: "desc" }, take: 10 }),
        ctx.cdb.customer.findFirst({ where: { id: quote.customerId }, select: { email: true, emailCc: true } }),
      ]);
      const vatName = new Map(vatRates.map((v) => [v.id, v.name]));
      preview = {
        id: quote.id,
        number: quote.number,
        status: quote.status,
        customerId: quote.customerId,
        customerName: quote.customerName,
        date: toISODate(quote.date),
        validUntil: quote.validUntil ? toISODate(quote.validUntil) : null,
        currency: quote.currency,
        netTotal: quote.netTotal.toFixed(2),
        vatTotal: quote.vatTotal.toFixed(2),
        total: quote.total.toFixed(2),
        notes: quote.notes,
        invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
        lines: quote.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity.toString(),
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          vat: l.vatRateId ? (vatName.get(l.vatRateId) ?? "") : "",
          netAmount: l.netAmount.toFixed(2),
        })),
        emails: emails.map((e) => ({ id: e.id, to: e.to, status: e.status, createdAt: e.createdAt.toISOString() })),
        email: await emailDefaults(ctx.company.id, { ...quote, type: "QUOTE" }, customer),
      };
    }
  }

  const canEdit = can(ctx.membership, "sales", "edit");
  const base = `/c/${companyId}/sales/quotes`;
  const link = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) next.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  const today = todayLocal();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.sales.quotes")}
        description={t("listSubtitle")}
        actions={
          canEdit && (
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus /> {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <ListSearch
        placeholder={t("search")}
        dates
        filters={[
          {
            name: "status",
            label: t("status"),
            options: [{ value: "", label: t("allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))],
          },
        ]}
      />
      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {quotes.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title={q || status ? t("noResults") : t("emptyTitle")}
              description={q || status ? undefined : t("emptyBody")}
              action={
                canEdit &&
                !q && (
                  <Button asChild>
                    <Link href={`${base}/new`}>
                      <Plus /> {t("new")}
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y" aria-label={t("listLabel")}>
              {quotes.map((x) => {
                const active = x.id === selectedId;
                const expired = x.validUntil && x.validUntil < today && (x.status === "DRAFT" || x.status === "SENT");
                return (
                  <li key={x.id}>
                    <Link
                      href={link({ doc: x.id })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", active && "bg-accent/60 hover:bg-accent/60")}
                    >
                      <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(x.date, locale)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] font-medium">{x.number}</span>
                          <Badge variant={({ DRAFT: "warning", SENT: "secondary", ACCEPTED: "success", REJECTED: "destructive", INVOICED: "outline" } as const)[x.status]}>{t(`statuses.${x.status}`)}</Badge>
                          {expired && <Badge variant="outline">{t("expired")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">{x.customerName}</div>
                      </div>
                      <div className="shrink-0 text-right text-sm font-medium tabular-nums">
                        {formatMoney(x.total, locale)}
                        {x.currency !== ctx.company.baseCurrency && <span className="ml-1 text-xs text-muted-foreground">{x.currency}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && <QuotePreview companyId={companyId} quote={preview} closeHref={link({ doc: null })} canEdit={canEdit} today={toISODate(today)} />}
      </div>
    </div>
  );
}
