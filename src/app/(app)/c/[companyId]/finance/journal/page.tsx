import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BookOpen, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { JournalFilters } from "./journal-filters";
import { EntryPreview, type PreviewEntry } from "./entry-preview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.finance.journal") };
}

const PAGE_SIZE = 50;
const SOURCES = ["OPENING_BALANCE", "MANUAL", "SALES_INVOICE", "PURCHASE_INVOICE", "EXPENSE_REPORT", "PAYMENT", "INVENTORY", "DEPRECIATION", "FIXED_ASSET", "VAT_CLOSING", "YEAR_END"] as const;

export default async function JournalPage({ params, searchParams }: PageProps<"/c/[companyId]/finance/journal">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "finance");
  const t = await getTranslations("journal");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  const from = parseISODate(str(sp.from));
  const to = parseISODate(str(sp.to));
  const status = str(sp.status) === "DRAFT" || str(sp.status) === "POSTED" ? (str(sp.status) as "DRAFT" | "POSTED") : null;
  const source = (SOURCES as readonly string[]).includes(str(sp.source)) ? (str(sp.source) as (typeof SOURCES)[number]) : null;
  const q = str(sp.q).trim();
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.entry);

  const where: Prisma.JournalEntryWhereInput = {
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { lines: { some: { description: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    ctx.cdb.journalEntry.count({ where }),
    ctx.cdb.journalEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { lines: { select: { debit: true } }, _count: { select: { reversedBy: true } } },
    }),
  ]);

  let preview: PreviewEntry | null = null;
  if (selectedId) {
    const e = await ctx.cdb.journalEntry.findFirst({
      where: { id: selectedId },
      include: {
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            account: { select: { code: true, name: true } },
            department: { select: { code: true } },
            vatRate: { select: { name: true } },
            dimensions: { include: { value: { select: { code: true, dimension: { select: { name: true } } } } } },
          },
        },
        reversalOf: { select: { id: true, number: true } },
        reversedBy: { select: { id: true, number: true } },
      },
    });
    if (e) {
      const userIds = [e.createdById, e.postedById].filter((x): x is string => Boolean(x));
      const users = userIds.length
        ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
        : [];
      const userName = (id: string | null) => {
        const u = users.find((x) => x.id === id);
        return u ? (u.name ?? u.email) : null;
      };
      preview = {
        id: e.id,
        number: e.number,
        status: e.status,
        source: e.source,
        sourceId: e.sourceId,
        date: toISODate(e.date),
        description: e.description,
        createdBy: userName(e.createdById),
        postedBy: userName(e.postedById),
        postedAt: e.postedAt?.toISOString() ?? null,
        reversalOf: e.reversalOf,
        reversedBy: e.reversedBy[0] ?? null,
        lines: e.lines.map((l) => ({
          id: l.id,
          account: `${l.account.code} ${l.account.name}`,
          description: l.description,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          department: l.department?.code ?? null,
          vat: l.vatRate ? `${l.vatRate.name}${l.vatAmount ? ` · ${l.vatAmount.toFixed(2)}` : ""}` : null,
          dimensions: l.dimensions.map((d) => `${d.value.dimension.name}: ${d.value.code}`),
        })),
      };
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) next.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    const s = next.toString();
    return `/c/${companyId}/finance/journal${s ? `?${s}` : ""}`;
  };
  const canEdit = can(ctx.membership, "finance", "edit");

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.finance.journal")}
        description={t("listSubtitle")}
        actions={
          canEdit && (
            <Button asChild>
              <Link href={`/c/${companyId}/finance/journal/new`}>
                <Plus /> {t("new")}
              </Link>
            </Button>
          )
        }
      />
      <JournalFilters
        initial={{ from: str(sp.from), to: str(sp.to), status: status ?? "", source: source ?? "", q }}
        sources={[...SOURCES]}
      />

      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {entries.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t("emptyTitle")}
              description={t("emptyBody")}
              action={
                canEdit && (
                  <Button asChild>
                    <Link href={`/c/${companyId}/finance/journal/new`}>
                      <Plus /> {t("new")}
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y" aria-label={t("listLabel")}>
              {entries.map((e) => {
                const amount = e.lines.reduce((s, l) => s.plus(l.debit.toString()), dec(0));
                const active = e.id === selectedId;
                return (
                  <li key={e.id}>
                    <Link
                      href={link({ entry: e.id })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50",
                        active && "bg-accent/60 hover:bg-accent/60",
                      )}
                    >
                      <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(e.date, locale)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-medium">{e.number ?? t("draftNumber")}</span>
                          {e.status === "DRAFT" && <Badge variant="warning">{t("statusDraft")}</Badge>}
                          {e._count.reversedBy > 0 && <Badge variant="outline">{t("reversed")}</Badge>}
                          {e.reversalOfId && <Badge variant="outline">{t("reversal")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {e.description || t(`sources.${e.source}`)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm font-medium tabular-nums">{formatMoney(amount, locale)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
              <span className="text-muted-foreground">{t("pageOf", { page, pages, total })}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" asChild disabled={page <= 1}>
                  <Link href={link({ page: page > 1 ? page - 1 : 1 })} aria-disabled={page <= 1}>
                    ←
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild disabled={page >= pages}>
                  <Link href={link({ page: Math.min(pages, page + 1) })} aria-disabled={page >= pages}>
                    →
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </Card>

        {preview && (
          <EntryPreview
            companyId={companyId}
            entry={preview}
            closeHref={link({ entry: null })}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "finance", "confirm")}
            today={toISODate(todayLocal())}
          />
        )}
      </div>
    </div>
  );
}
