import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardList, Plus } from "lucide-react";
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
import { OrderPreview, type OrderPreviewData } from "./order-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.orders") };
}

const PAGE_SIZE = 50;
const STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "INVOICED", "CANCELLED"] as const;
const BADGE = { DRAFT: "warning", ORDERED: "secondary", RECEIVED: "success", INVOICED: "outline", CANCELLED: "destructive" } as const;

export default async function OrdersPage({ params, searchParams }: PageProps<"/c/[companyId]/purchases/orders">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("orders");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const status = (STATUSES as readonly string[]).includes(str(sp.status)) ? (str(sp.status) as (typeof STATUSES)[number]) : null;
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(status ? { status } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { supplierName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, orders] = await Promise.all([
    ctx.cdb.purchaseOrder.count({ where }),
    ctx.cdb.purchaseOrder.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  let preview: OrderPreviewData | null = null;
  if (selectedId) {
    const o = await ctx.cdb.purchaseOrder.findFirst({ where: { id: selectedId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    if (o) {
      const invoice = o.invoiceId ? await ctx.cdb.purchaseInvoice.findFirst({ where: { id: o.invoiceId }, select: { id: true, number: true } }) : null;
      preview = {
        id: o.id,
        number: o.number,
        status: o.status,
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        date: toISODate(o.date),
        expectedDate: o.expectedDate ? toISODate(o.expectedDate) : null,
        currency: o.currency,
        netTotal: o.netTotal.toFixed(2),
        vatTotal: o.vatTotal.toFixed(2),
        total: o.total.toFixed(2),
        notes: o.notes,
        invoice,
        lines: o.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity.toString(), unit: l.unit, unitPrice: l.unitPrice.toString(), netAmount: l.netAmount.toFixed(2) })),
      };
    }
  }
  const canEdit = can(ctx.membership, "purchases", "edit");
  const base = `/c/${companyId}/purchases/orders`;
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
        title={tn("items.purchases.orders")}
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
        filters={[{ name: "status", label: t("status"), options: [{ value: "", label: t("allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))] }]}
      />
      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {orders.length === 0 ? (
            <EmptyState icon={ClipboardList} title={q || status ? t("noResults") : t("emptyTitle")} description={q || status ? undefined : t("emptyBody")} />
          ) : (
            <ul className="divide-y" aria-label={t("listLabel")}>
              {orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={link({ doc: o.id })}
                    scroll={false}
                    aria-current={o.id === selectedId ? "true" : undefined}
                    className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", o.id === selectedId && "bg-accent/60 hover:bg-accent/60")}
                  >
                    <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(o.date, locale)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px] font-medium">{o.number}</span>
                        <Badge variant={BADGE[o.status]}>{t(`statuses.${o.status}`)}</Badge>
                        {o.expectedDate && o.expectedDate < todayLocal() && o.status === "ORDERED" && <Badge variant="outline">{t("late")}</Badge>}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">{o.supplierName}</div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium tabular-nums">{formatMoney(o.total, locale)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && <OrderPreview companyId={companyId} order={preview} closeHref={link({ doc: null })} canEdit={canEdit} today={toISODate(todayLocal())} />}
      </div>
    </div>
  );
}
