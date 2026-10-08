import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus, Wallet } from "lucide-react";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pager } from "@/components/common/list-controls";
import { ExpensePreview, type ExpensePreviewData } from "./expense-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.purchases.expenses") };
}

const PAGE_SIZE = 50;

export default async function ExpenseReportsPage({ params, searchParams }: PageProps<"/c/[companyId]/purchases/expenses">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "purchases");
  const t = await getTranslations("expenses");
  const ti = await getTranslations("invoices");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const [total, reports] = await Promise.all([
    ctx.cdb.expenseReport.count(),
    ctx.cdb.expenseReport.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  let preview: ExpensePreviewData | null = null;
  if (selectedId) {
    const r = await ctx.cdb.expenseReport.findFirst({ where: { id: selectedId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    if (r) {
      const [accounts, attachments, journal] = await Promise.all([
        ctx.cdb.glAccount.findMany({ where: { id: { in: r.lines.map((l) => l.accountId) } }, select: { id: true, code: true, name: true } }),
        ctx.cdb.attachment.findMany({ where: { documentType: "ExpenseReport", documentId: r.id }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, size: true } }),
        r.journalEntryId ? ctx.cdb.journalEntry.findFirst({ where: { id: r.journalEntryId }, select: { id: true, number: true } }) : null,
      ]);
      const accountName = new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`]));
      preview = {
        id: r.id,
        status: r.status,
        number: r.number,
        employeeName: r.employeeName,
        date: toISODate(r.date),
        description: r.description,
        vatTotal: r.vatTotal.toFixed(2),
        total: r.total.toFixed(2),
        journal,
        attachments,
        lines: r.lines.map((l) => ({
          id: l.id,
          date: toISODate(l.date),
          vendor: l.vendor,
          description: l.description,
          account: accountName.get(l.accountId) ?? "",
          grossAmount: l.grossAmount.toFixed(2),
          vatAmount: l.vatAmount.toFixed(2),
        })),
      };
    }
  }
  const canEdit = can(ctx.membership, "purchases", "edit");
  const base = `/c/${companyId}/purchases/expenses`;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.purchases.expenses")}
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
      <div className={cn("grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {reports.length === 0 ? (
            <EmptyState icon={Wallet} title={t("emptyTitle")} description={t("emptyBody")} />
          ) : (
            <ul className="divide-y" aria-label={t("listLabel")}>
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`${base}?doc=${r.id}${page > 1 ? `&page=${page}` : ""}`}
                    scroll={false}
                    aria-current={r.id === selectedId ? "true" : undefined}
                    className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", r.id === selectedId && "bg-accent/60 hover:bg-accent/60")}
                  >
                    <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(r.date, locale)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[13px] font-medium">{r.number ?? ti("draftNumber")}</span>
                        {r.status === "DRAFT" && <Badge variant="warning">{ti("statusDraft")}</Badge>}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {r.employeeName}
                        {r.description ? ` · ${r.description}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium tabular-nums">{formatMoney(r.total, locale)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} label={t("pageOf", { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total })} />
        </Card>
        {preview && (
          <ExpensePreview
            companyId={companyId}
            report={preview}
            closeHref={base}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "purchases", "confirm")}
            canViewLedger={can(ctx.membership, "finance", "view")}
          />
        )}
      </div>
    </div>
  );
}
