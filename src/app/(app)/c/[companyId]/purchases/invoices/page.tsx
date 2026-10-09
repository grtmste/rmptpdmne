import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Inbox, Plus, Receipt } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatIban } from "@/lib/iban";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { paymentsFor } from "@/server/sales/payments-for";
import { PurchasePreview, type PurchasePreviewData } from "./purchase-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.invoices") };
}

const PAGE_SIZE = 50;

export default async function PurchaseInvoicesPage({ params, searchParams }: PageProps<"/c/[companyId]/purchases/invoices">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("purchases");
  const ti = await getTranslations("invoices");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const status = str(sp.status) === "DRAFT" || str(sp.status) === "CONFIRMED" ? (str(sp.status) as "DRAFT" | "CONFIRMED") : null;
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const today = todayLocal();

  const where: Prisma.PurchaseInvoiceWhereInput = {
    ...(status ? { status } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { invoiceNumber: { contains: q, mode: "insensitive" } },
            { supplierName: { contains: q, mode: "insensitive" } },
            { lines: { some: { description: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [total, invoices, sums, inboxCount] = await Promise.all([
    ctx.cdb.purchaseInvoice.count({ where }),
    ctx.cdb.purchaseInvoice.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, number: true, invoiceNumber: true, status: true, isCredit: true, supplierName: true, date: true, dueDate: true, total: true, paidTotal: true, currency: true, source: true },
    }),
    ctx.cdb.purchaseInvoice.aggregate({ where: { ...where, status: "CONFIRMED" }, _sum: { totalBase: true } }),
    ctx.cdb.purchaseInvoice.count({ where: { status: "DRAFT", source: "UPLOAD" } }),
  ]);

  let preview: PurchasePreviewData | null = null;
  if (selectedId) {
    const inv = await ctx.cdb.purchaseInvoice.findFirst({
      where: { id: selectedId },
      include: { lines: { orderBy: { sortOrder: "asc" } }, creditOf: { select: { id: true, number: true } }, credits: { select: { id: true, number: true } } },
    });
    if (inv) {
      const [accounts, vatRates, attachments, journal, order] = await Promise.all([
        ctx.cdb.glAccount.findMany({ where: { id: { in: inv.lines.map((l) => l.accountId) } }, select: { id: true, code: true, name: true } }),
        ctx.cdb.vatRate.findMany({ where: { id: { in: inv.lines.map((l) => l.vatRateId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
        ctx.cdb.attachment.findMany({ where: { documentType: "PurchaseInvoice", documentId: inv.id }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, size: true } }),
        inv.journalEntryId ? ctx.cdb.journalEntry.findFirst({ where: { id: inv.journalEntryId }, select: { id: true, number: true } }) : null,
        inv.purchaseOrderId ? ctx.cdb.purchaseOrder.findFirst({ where: { id: inv.purchaseOrderId }, select: { id: true, number: true } }) : null,
      ]);
      const accountName = new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`]));
      const vatName = new Map(vatRates.map((v) => [v.id, v.name]));
      preview = {
        id: inv.id,
        status: inv.status,
        isCredit: inv.isCredit,
        number: inv.number,
        invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId,
        supplierName: inv.supplierName,
        date: toISODate(inv.date),
        dueDate: toISODate(inv.dueDate),
        referenceNumber: inv.referenceNumber,
        bankAccount: inv.bankAccount ? formatIban(inv.bankAccount) : null,
        currency: inv.currency,
        netTotal: inv.netTotal.toFixed(2),
        vatTotal: inv.vatTotal.toFixed(2),
        total: inv.total.toFixed(2),
        notes: inv.notes,
        creditOf: inv.creditOf,
        credits: inv.credits,
        journal,
        order,
        lines: inv.lines.map((l) => ({
          id: l.id,
          description: l.description,
          account: accountName.get(l.accountId) ?? "",
          vat: l.vatRateId ? (vatName.get(l.vatRateId) ?? "") : "",
          netAmount: l.netAmount.toFixed(2),
          vatAmount: l.vatAmount.plus(l.reverseVatAmount).toFixed(2),
        })),
        attachments,
        paidTotal: inv.paidTotal.toFixed(2),
        payments: await paymentsFor(ctx, "purchaseInvoiceId", inv.id),
      };
    }
  }

  const canEdit = can(ctx.membership, "purchases", "edit");
  const base = `/c/${companyId}/purchases/invoices`;
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
        title={tn("items.purchases.invoices")}
        description={t("listSubtitle")}
        actions={
          <>
            {inboxCount > 0 && (
              <Button asChild variant="outline">
                <Link href={`/c/${companyId}/purchases/inbox`}>
                  <Inbox /> {t("inboxCount", { count: inboxCount })}
                </Link>
              </Button>
            )}
            {canEdit && (
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus /> {t("new")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <ListSearch
        placeholder={t("search")}
        dates
        filters={[
          {
            name: "status",
            label: ti("status"),
            options: [
              { value: "", label: ti("allStatuses") },
              { value: "DRAFT", label: ti("statusDraft") },
              { value: "CONFIRMED", label: ti("statusConfirmed") },
            ],
          },
        ]}
      />
      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {invoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={q || status || from || to ? ti("noResults") : t("emptyTitle")}
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
              {invoices.map((i) => {
                const active = i.id === selectedId;
                const paid = i.status === "CONFIRMED" && !i.total.isZero() && i.paidTotal.equals(i.total);
                const partly = i.status === "CONFIRMED" && !i.paidTotal.isZero() && !paid;
                const overdue = i.status === "CONFIRMED" && !i.isCredit && !paid && i.dueDate < today;
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
                          <span className="font-mono text-[13px] font-medium">{i.number ?? ti("draftNumber")}</span>
                          {i.invoiceNumber && <span className="text-xs text-muted-foreground">· {i.invoiceNumber}</span>}
                          {i.status === "DRAFT" && <Badge variant="warning">{ti("statusDraft")}</Badge>}
                          {i.isCredit && <Badge variant="outline">{ti("types.CREDIT")}</Badge>}
                          {i.source === "UPLOAD" && i.status === "DRAFT" && <Badge variant="secondary">{t("uploaded")}</Badge>}
                          {paid && <Badge variant="success">{ti("paid")}</Badge>}
                          {partly && <Badge variant="outline">{ti("partlyPaid")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">{i.supplierName || t("noSupplierYet")}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium tabular-nums">
                          {formatMoney(i.total, locale)}
                          {i.currency !== ctx.company.baseCurrency && <span className="ml-1 text-xs text-muted-foreground">{i.currency}</span>}
                        </div>
                        {i.status === "CONFIRMED" && !i.isCredit && !paid && (
                          <div className={cn("text-xs tabular-nums", overdue ? "text-warning" : "text-muted-foreground")}>
                            {ti("dueShort", { date: formatDate(i.dueDate, locale) })}
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
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={ti("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && (
          <PurchasePreview
            companyId={companyId}
            invoice={preview}
            closeHref={link({ doc: null })}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "purchases", "confirm")}
            canViewLedger={can(ctx.membership, "finance", "view")}
            today={toISODate(today)}
            canAddAsset={can(ctx.membership, "assets", "edit")}
          />
        )}
      </div>
    </div>
  );
}
