import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronDown, FileText, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { InvoicePreview, type InvoicePreviewData } from "./invoice-preview";
import { emailDefaults } from "@/server/sales/email-defaults";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.sales.invoices") };
}

const PAGE_SIZE = 50;

export default async function InvoicesPage({ params, searchParams }: PageProps<"/c/[companyId]/sales/invoices">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "sales");
  const t = await getTranslations("invoices");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const status = str(sp.status) === "DRAFT" || str(sp.status) === "CONFIRMED" ? (str(sp.status) as "DRAFT" | "CONFIRMED") : null;
  const type = ["INVOICE", "CREDIT", "PREPAYMENT"].includes(str(sp.type)) ? (str(sp.type) as "INVOICE" | "CREDIT" | "PREPAYMENT") : null;
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const today = todayLocal();

  const where: Prisma.SalesInvoiceWhereInput = {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customerName: { contains: q, mode: "insensitive" } },
            { referenceNumber: { contains: q } },
            { lines: { some: { description: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [total, invoices, sums] = await Promise.all([
    ctx.cdb.salesInvoice.count({ where }),
    ctx.cdb.salesInvoice.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        customerName: true,
        date: true,
        dueDate: true,
        total: true,
        totalBase: true,
        currency: true,
        sentAt: true,
        taxFree: true,
      },
    }),
    ctx.cdb.salesInvoice.aggregate({ where: { ...where, status: "CONFIRMED" }, _sum: { totalBase: true } }),
  ]);

  let preview: InvoicePreviewData | null = null;
  if (selectedId) {
    const inv = await ctx.cdb.salesInvoice.findFirst({
      where: { id: selectedId },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        creditOf: { select: { id: true, number: true } },
        credits: { select: { id: true, number: true, status: true, taxFree: true } },
      },
    });
    if (inv) {
      const [emails, vatRates, quote, journal, attachments] = await Promise.all([
        ctx.cdb.emailLog.findMany({ where: { documentType: "SalesInvoice", documentId: inv.id }, orderBy: { createdAt: "desc" }, take: 10 }),
        ctx.cdb.vatRate.findMany({ where: { id: { in: inv.lines.map((l) => l.vatRateId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
        inv.quoteId ? ctx.cdb.quote.findFirst({ where: { id: inv.quoteId }, select: { id: true, number: true } }) : null,
        inv.journalEntryId ? ctx.cdb.journalEntry.findFirst({ where: { id: inv.journalEntryId }, select: { id: true, number: true } }) : null,
        ctx.cdb.attachment.findMany({
          where: { documentType: "SalesInvoice", documentId: inv.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, fileName: true, contentType: true, size: true },
        }),
      ]);
      const vatName = new Map(vatRates.map((v) => [v.id, v.name]));
      const confirmer = inv.confirmedById ? await db.user.findUnique({ where: { id: inv.confirmedById }, select: { name: true, email: true } }) : null;
      const customer = await ctx.cdb.customer.findFirst({ where: { id: inv.customerId }, select: { email: true, emailCc: true } });
      preview = {
        id: inv.id,
        type: inv.type,
        status: inv.status,
        number: inv.number,
        customerId: inv.customerId,
        customerName: inv.customerName,
        customerAddress: inv.customerAddress,
        customerRegCode: inv.customerRegCode,
        date: toISODate(inv.date),
        dueDate: toISODate(inv.dueDate),
        referenceNumber: inv.referenceNumber,
        currency: inv.currency,
        currencyRate: inv.currency !== ctx.company.baseCurrency ? inv.currencyRate.toString() : null,
        netTotal: inv.netTotal.toFixed(2),
        vatTotal: inv.vatTotal.toFixed(2),
        total: inv.total.toFixed(2),
        totalBase: inv.totalBase.toFixed(2),
        notes: inv.notes,
        taxFree: inv.taxFree,
        sentAt: inv.sentAt?.toISOString() ?? null,
        confirmedBy: confirmer ? (confirmer.name ?? confirmer.email) : null,
        confirmedAt: inv.confirmedAt?.toISOString() ?? null,
        creditOf: inv.creditOf,
        credits: inv.credits,
        quote,
        journal,
        lines: inv.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity.toString(),
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          discountPct: l.discountPct.toString(),
          vat: l.vatRateId ? (vatName.get(l.vatRateId) ?? "") : "",
          amount: l.netAmount.plus(l.vatAmount).toFixed(2),
          netAmount: l.netAmount.toFixed(2),
        })),
        emails: emails.map((e) => ({ id: e.id, to: e.to, status: e.status, createdAt: e.createdAt.toISOString(), error: e.error })),
        email: inv.status === "CONFIRMED" ? await emailDefaults(ctx.company.id, inv, customer) : null,
        attachments,
      };
    }
  }

  const canEdit = can(ctx.membership, "sales", "edit");
  const base = `/c/${companyId}/sales/invoices`;
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

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.sales.invoices")}
        description={t("listSubtitle")}
        actions={
          canEdit && (
            <div className="flex">
              <Button asChild className="rounded-r-none">
                <Link href={`${base}/new`}>
                  <Plus /> {t("new")}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label={t("moreNew")}>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`${base}/new?type=PREPAYMENT`}>{t("newPrepaymentTitle")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/c/${companyId}/sales/quotes/new`}>{t("newQuote")}</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
            options: [
              { value: "", label: t("allStatuses") },
              { value: "DRAFT", label: t("statusDraft") },
              { value: "CONFIRMED", label: t("statusConfirmed") },
            ],
          },
          {
            name: "type",
            label: t("type"),
            options: [
              { value: "", label: t("allTypes") },
              { value: "INVOICE", label: t("types.INVOICE") },
              { value: "CREDIT", label: t("types.CREDIT") },
              { value: "PREPAYMENT", label: t("types.PREPAYMENT") },
            ],
          },
        ]}
      />

      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={q || status || type || from || to ? t("noResults") : t("emptyTitle")}
              description={q || status || type ? undefined : t("emptyBody")}
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
              {invoices.map((i) => {
                const active = i.id === selectedId;
                const overdue = i.status === "CONFIRMED" && i.type === "INVOICE" && i.dueDate < today;
                return (
                  <li key={i.id}>
                    <Link
                      href={link({ doc: i.id })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", active && "bg-accent/60 hover:bg-accent/60")}
                    >
                      <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(i.date, locale)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] font-medium">{i.number ?? t("draftNumber")}</span>
                          {i.status === "DRAFT" && <Badge variant="warning">{t("statusDraft")}</Badge>}
                          {i.type !== "INVOICE" && <Badge variant="outline">{i.taxFree ? t("taxFree") : t(`types.${i.type}`)}</Badge>}
                          {i.sentAt && <Badge variant="secondary">{t("sent")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">{i.customerName}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium tabular-nums">
                          {formatMoney(i.total, locale)}
                          {i.currency !== ctx.company.baseCurrency && <span className="ml-1 text-xs text-muted-foreground">{i.currency}</span>}
                        </div>
                        {i.status === "CONFIRMED" && i.type === "INVOICE" && (
                          <div className={cn("text-xs tabular-nums", overdue ? "text-warning" : "text-muted-foreground")}>
                            {t("dueShort", { date: formatDate(i.dueDate, locale) })}
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {invoices.length > 0 && (
            <div className="flex justify-between border-t bg-muted/30 px-4 py-2 text-sm">
              <span className="text-muted-foreground">{t("confirmedTotal")}</span>
              <span className="font-medium tabular-nums">{formatMoney(sums._sum.totalBase ?? 0, locale, { currency: ctx.company.baseCurrency })}</span>
            </div>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && (
          <InvoicePreview
            companyId={companyId}
            invoice={preview}
            closeHref={link({ doc: null })}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "sales", "confirm")}
            canViewLedger={can(ctx.membership, "finance", "view")}
            today={toISODate(today)}
          />
        )}
      </div>
    </div>
  );
}
