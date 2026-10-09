import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, ChevronDown, Plus } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { PaymentPreview, type PaymentPreviewData } from "./payment-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.payments.list") };
}

const PAGE_SIZE = 50;
const ICON = { IN: ArrowDownLeft, OUT: ArrowUpRight, NETTING: ArrowLeftRight } as const;

export default async function PaymentsPage({ params, searchParams }: PageProps<"/c/[companyId]/payments">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "payments");
  const t = await getTranslations("payments");
  const ti = await getTranslations("invoices");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const direction = ["IN", "OUT", "NETTING"].includes(str(sp.direction)) ? (str(sp.direction) as "IN" | "OUT" | "NETTING") : null;
  const account = str(sp.account);
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const where: Prisma.PaymentWhereInput = {
    ...(direction ? { direction } : {}),
    ...(account ? { bankAccountId: account } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { partyName: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { referenceNumber: { startsWith: q } },
          ],
        }
      : {}),
  };
  const [total, payments, bankAccounts] = await Promise.all([
    ctx.cdb.payment.count({ where }),
    ctx.cdb.payment.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { bankAccount: { select: { name: true } } } }),
    ctx.cdb.bankAccount.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);

  let preview: PaymentPreviewData | null = null;
  if (selectedId) {
    const p = await ctx.cdb.payment.findFirst({ where: { id: selectedId }, include: { allocations: { orderBy: { sortOrder: "asc" } }, bankAccount: { select: { name: true } } } });
    if (p) {
      const ids = (k: "salesInvoiceId" | "purchaseInvoiceId" | "expenseReportId" | "accountId") => p.allocations.flatMap((a) => (a[k] ? [a[k]!] : []));
      const [sales, purchases, expenses, accounts, journal] = await Promise.all([
        ctx.cdb.salesInvoice.findMany({ where: { id: { in: ids("salesInvoiceId") } }, select: { id: true, number: true } }),
        ctx.cdb.purchaseInvoice.findMany({ where: { id: { in: ids("purchaseInvoiceId") } }, select: { id: true, number: true, invoiceNumber: true } }),
        ctx.cdb.expenseReport.findMany({ where: { id: { in: ids("expenseReportId") } }, select: { id: true, number: true } }),
        ctx.cdb.glAccount.findMany({ where: { id: { in: ids("accountId") } }, select: { id: true, code: true, name: true } }),
        p.journalEntryId ? ctx.cdb.journalEntry.findFirst({ where: { id: p.journalEntryId }, select: { id: true, number: true } }) : null,
      ]);
      const label = new Map<string, { text: string; href: string | null }>([
        ...sales.map((s) => [s.id, { text: s.number ?? "", href: `/c/${companyId}/sales/invoices?doc=${s.id}` }] as const),
        ...purchases.map((s) => [s.id, { text: `${s.number ?? ""}${s.invoiceNumber ? ` (${s.invoiceNumber})` : ""}`, href: `/c/${companyId}/purchases/invoices?doc=${s.id}` }] as const),
        ...expenses.map((s) => [s.id, { text: s.number ?? "", href: `/c/${companyId}/purchases/expenses?doc=${s.id}` }] as const),
        ...accounts.map((a) => [a.id, { text: `${a.code} ${a.name}`, href: null }] as const),
      ]);
      preview = {
        id: p.id,
        number: p.number,
        status: p.status,
        cancelled: Boolean(p.cancelledAt),
        direction: p.direction,
        bankAccount: p.bankAccount?.name ?? null,
        date: toISODate(p.date),
        amount: p.amount.toFixed(2),
        currency: p.currency,
        partyName: p.partyName,
        partyIban: p.partyIban,
        referenceNumber: p.referenceNumber,
        description: p.description,
        journal,
        allocations: p.allocations.map((a) => {
          const target = label.get((a.salesInvoiceId ?? a.purchaseInvoiceId ?? a.expenseReportId ?? a.accountId) ?? "");
          return { id: a.id, type: a.type, label: target?.text ?? "", href: target?.href ?? null, amount: a.amount.toFixed(2), description: a.description };
        }),
      };
    }
  }

  const canEdit = can(ctx.membership, "payments", "edit");
  const base = `/c/${companyId}/payments`;
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
        title={tn("items.payments.list")}
        description={t("listSubtitle")}
        actions={
          canEdit && (
            <div className="flex">
              <Button asChild className="rounded-r-none">
                <Link href={`${base}/new`}>
                  <Plus /> {t("newIn")}
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
                    <Link href={`${base}/new?direction=OUT`}>{t("newOut")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`${base}/new?direction=NETTING`}>{t("newNetting")}</Link>
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
            name: "direction",
            label: t("direction"),
            options: [{ value: "", label: t("allDirections") }, ...(["IN", "OUT", "NETTING"] as const).map((d) => ({ value: d, label: t(`directions.${d}`) }))],
          },
          { name: "account", label: t("account"), options: [{ value: "", label: t("allAccounts") }, ...bankAccounts.map((b) => ({ value: b.id, label: b.name }))] },
        ]}
      />
      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {payments.length === 0 ? (
            <EmptyState icon={Banknote} title={q || direction ? ti("noResults") : t("emptyTitle")} description={q || direction ? undefined : t("emptyBody")} />
          ) : (
            <ul className="divide-y" aria-label={t("listLabel")}>
              {payments.map((p) => {
                const Icon = ICON[p.direction];
                return (
                  <li key={p.id}>
                    <Link
                      href={link({ doc: p.id })}
                      scroll={false}
                      aria-current={p.id === selectedId ? "true" : undefined}
                      className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", p.id === selectedId && "bg-accent/60 hover:bg-accent/60")}
                    >
                      <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(p.date, locale)}</div>
                      <Icon className={cn("size-4 shrink-0", p.direction === "IN" ? "text-success" : p.direction === "OUT" ? "text-warning" : "text-muted-foreground")} aria-label={t(`directions.${p.direction}`)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] font-medium">{p.number ?? ti("draftNumber")}</span>
                          {p.status === "DRAFT" && <Badge variant="warning">{ti("statusDraft")}</Badge>}
                          {p.cancelledAt && <Badge variant="destructive">{t("cancelled")}</Badge>}
                          {p.statementLineId && <Badge variant="outline">{t("fromStatement")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {p.partyName || p.description || "—"}
                          {p.bankAccount ? ` · ${p.bankAccount.name}` : ""}
                        </div>
                      </div>
                      <div className={cn("shrink-0 text-right text-sm font-medium tabular-nums", p.cancelledAt && "line-through opacity-60")}>
                        {p.direction === "OUT" ? "−" : ""}
                        {formatMoney(p.amount, locale)}
                        {p.currency !== ctx.company.baseCurrency && <span className="ml-1 text-xs text-muted-foreground">{p.currency}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && (
          <PaymentPreview
            companyId={companyId}
            payment={preview}
            closeHref={link({ doc: null })}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "payments", "confirm")}
            canViewLedger={can(ctx.membership, "finance", "view")}
            today={toISODate(todayLocal())}
          />
        )}
      </div>
    </div>
  );
}
