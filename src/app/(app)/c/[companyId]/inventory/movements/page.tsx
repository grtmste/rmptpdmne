import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Boxes, ChevronDown, ClipboardCheck, Plus, ShoppingCart, TrendingUp } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { MovementPreview, type MovementPreviewData } from "./movement-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.inventory.movements") };
}

const PAGE_SIZE = 50;
const TYPES = ["RECEIPT", "ISSUE", "TRANSFER", "COUNT", "SALE", "PURCHASE"] as const;
const ICON = { RECEIPT: ArrowDownToLine, ISSUE: ArrowUpFromLine, TRANSFER: ArrowLeftRight, COUNT: ClipboardCheck, SALE: TrendingUp, PURCHASE: ShoppingCart } as const;

export default async function MovementsPage({ params, searchParams }: PageProps<"/c/[companyId]/inventory/movements">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "inventory");
  const t = await getTranslations("inventory");
  const ti = await getTranslations("invoices");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const type = (TYPES as readonly string[]).includes(str(sp.type)) ? (str(sp.type) as (typeof TYPES)[number]) : null;
  const warehouse = str(sp.warehouse);
  const item = str(sp.item);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const where: Prisma.StockMovementWhereInput = {
    ...(type ? { type } : {}),
    ...(warehouse ? { OR: [{ warehouseId: warehouse }, { toWarehouseId: warehouse }] } : {}),
    ...(item ? { lines: { some: { itemId: item } } } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          AND: [
            {
              OR: [
                { number: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { lines: { some: { item: { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } } } },
              ],
            },
          ],
        }
      : {}),
  };
  const [total, movements, warehouses] = await Promise.all([
    ctx.cdb.stockMovement.count({ where }),
    ctx.cdb.stockMovement.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { _count: { select: { lines: true } } } }),
    ctx.cdb.warehouse.findMany({ orderBy: { code: "asc" }, select: { id: true, name: true } }),
  ]);
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  let preview: MovementPreviewData | null = null;
  if (selectedId) {
    const m = await ctx.cdb.stockMovement.findFirst({ where: { id: selectedId }, include: { lines: { orderBy: { sortOrder: "asc" }, include: { item: { select: { code: true, name: true, unit: true } } } } } });
    if (m) {
      const [account, journal, sale, purchase] = await Promise.all([
        m.counterAccountId ? ctx.cdb.glAccount.findFirst({ where: { id: m.counterAccountId }, select: { code: true, name: true } }) : null,
        m.journalEntryId ? ctx.cdb.journalEntry.findFirst({ where: { id: m.journalEntryId }, select: { id: true, number: true } }) : null,
        m.salesInvoiceId ? ctx.cdb.salesInvoice.findFirst({ where: { id: m.salesInvoiceId }, select: { id: true, number: true } }) : null,
        m.purchaseInvoiceId ? ctx.cdb.purchaseInvoice.findFirst({ where: { id: m.purchaseInvoiceId }, select: { id: true, number: true, invoiceNumber: true } }) : null,
      ]);
      preview = {
        id: m.id,
        number: m.number,
        status: m.status,
        type: m.type,
        date: toISODate(m.date),
        warehouse: whName.get(m.warehouseId) ?? "",
        toWarehouse: m.toWarehouseId ? (whName.get(m.toWarehouseId) ?? "") : null,
        counterAccount: account ? `${account.code} ${account.name}` : null,
        description: m.description,
        totalCost: m.totalCost.toFixed(2),
        source: sale
          ? { label: t("sourceSale", { number: sale.number ?? "" }), href: `/c/${companyId}/sales/invoices?doc=${sale.id}` }
          : purchase
            ? { label: t("sourcePurchase", { number: `${purchase.number ?? ""}${purchase.invoiceNumber ? ` (${purchase.invoiceNumber})` : ""}` }), href: `/c/${companyId}/purchases/invoices?doc=${purchase.id}` }
            : null,
        journal,
        lines: m.lines.map((l) => ({
          id: l.id,
          code: l.item.code,
          name: l.item.name,
          unit: l.item.unit,
          quantity: l.quantity.toString(),
          counted: l.countedQuantity?.toString() ?? null,
          unitCost: l.unitCost.toString(),
          totalCost: l.totalCost.toFixed(2),
        })),
      };
    }
  }

  const canEdit = can(ctx.membership, "inventory", "edit");
  const base = `/c/${companyId}/inventory/movements`;
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
  const filtered = Boolean(q || type || warehouse || item || from || to);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.inventory.movements")}
        description={t("movementsSubtitle")}
        actions={
          canEdit && (
            <div className="flex">
              <Button asChild className="rounded-r-none">
                <Link href={`${base}/new?type=RECEIPT`}>
                  <Plus /> {t("newReceipt")}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label={t("moreNew")}>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(["ISSUE", "TRANSFER", "COUNT"] as const).map((k) => (
                    <DropdownMenuItem key={k} asChild>
                      <Link href={`${base}/new?type=${k}`}>{t(`new.${k}`)}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      <ListSearch
        placeholder={t("searchMovements")}
        dates
        filters={[
          { name: "type", label: t("type"), options: [{ value: "", label: t("allTypes") }, ...TYPES.map((k) => ({ value: k, label: t(`types.${k}`) }))] },
          { name: "warehouse", label: t("warehouse"), options: [{ value: "", label: t("allWarehouses") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))] },
        ]}
      />
      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {movements.length === 0 ? (
            <EmptyState icon={Boxes} title={filtered ? t("noResults") : t("emptyTitle")} description={filtered ? undefined : t("emptyBody")} />
          ) : (
            <ul className="divide-y" aria-label={t("listLabel")}>
              {movements.map((m) => {
                const Icon = ICON[m.type];
                return (
                  <li key={m.id}>
                    <Link
                      href={link({ doc: m.id })}
                      scroll={false}
                      aria-current={m.id === selectedId ? "true" : undefined}
                      className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", m.id === selectedId && "bg-accent/60 hover:bg-accent/60")}
                    >
                      <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(m.date, locale)}</div>
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] font-medium">{m.number ?? ti("draftNumber")}</span>
                          <span className="text-xs text-muted-foreground">{t(`types.${m.type}`)}</span>
                          {m.status === "DRAFT" && <Badge variant="warning">{ti("statusDraft")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {whName.get(m.warehouseId)}
                          {m.toWarehouseId ? ` → ${whName.get(m.toWarehouseId)}` : ""}
                          {m.description ? ` · ${m.description}` : ""} · {t("lineCount", { count: m._count.lines })}
                        </div>
                      </div>
                      {m.type !== "TRANSFER" && m.status === "CONFIRMED" && (
                        <div className="shrink-0 text-right text-sm font-medium tabular-nums">{formatMoney(m.totalCost, locale)}</div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && (
          <MovementPreview
            companyId={companyId}
            movement={preview}
            closeHref={link({ doc: null })}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "inventory", "confirm")}
            canViewLedger={can(ctx.membership, "finance", "view")}
          />
        )}
      </div>
    </div>
  );
}
