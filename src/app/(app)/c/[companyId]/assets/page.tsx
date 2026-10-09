import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PackageOpen, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { depreciationSchedule, monthStart } from "@/lib/assets/depreciation";
import { formatDate, todayLocal } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { assetState, ensureDefaultAssetGroups } from "@/server/services/assets";
import { saveAssetLocation, deleteAssetLocation } from "@/server/actions/assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ListSearch, Pager } from "@/components/common/list-controls";
import { AssetPreview, type AssetPreviewData } from "./asset-preview";
import { AssetGroupsDialog } from "./asset-groups-dialog";
import { LocationsDialog } from "./locations-dialog";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.assets.register") };
}

const PAGE_SIZE = 50;

export default async function AssetsPage({ params, searchParams }: PageProps<"/c/[companyId]/assets">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "assets");
  const t = await getTranslations("assets");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  await db.$transaction((tx) => ensureDefaultAssetGroups(tx, companyId, ctx.user.id));
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const q = str(sp.q).trim();
  const groupId = str(sp.group);
  const locationId = str(sp.location);
  const status = str(sp.status) === "DISPOSED" ? "DISPOSED" : str(sp.status) === "all" ? null : "ACTIVE";
  const page = Math.max(1, Number(str(sp.page)) || 1);
  const selectedId = str(sp.doc);
  const where: Prisma.FixedAssetWhereInput = {
    ...(status ? { status } : {}),
    ...(groupId ? { groupId } : {}),
    ...(locationId ? { locationId } : {}),
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { serialNumber: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, assets, groups, locations, accounts] = await Promise.all([
    ctx.cdb.fixedAsset.count({ where }),
    ctx.cdb.fixedAsset.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { group: { select: { name: true } }, location: { select: { name: true } } },
    }),
    ctx.cdb.fixedAssetGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { assets: true } } } }),
    ctx.cdb.fixedAssetLocation.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { assets: true } } } }),
    ctx.cdb.glAccount.findMany({ where: { active: true, kind: "DETAIL" }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, type: true } }),
  ]);
  // Bilansiline väärtus nimekirjas: soetusmaksumus − kulum (kõik arvestatud)
  const ids = assets.map((a) => a.id);
  const [lineSums, eventSums] = await Promise.all([
    ctx.cdb.depreciationLine.groupBy({ by: ["assetId"], where: { assetId: { in: ids } }, _sum: { amount: true } }),
    ctx.cdb.fixedAssetEvent.groupBy({ by: ["assetId"], where: { assetId: { in: ids }, type: { not: "DISPOSAL" } }, _sum: { accumulatedDelta: true } }),
  ]);
  const accBy = new Map<string, ReturnType<typeof dec>>();
  for (const l of lineSums) accBy.set(l.assetId, dec(l._sum.amount ?? 0));
  for (const e of eventSums) accBy.set(e.assetId, (accBy.get(e.assetId) ?? dec(0)).plus(dec(e._sum.accumulatedDelta ?? 0)));

  const accountLabel = new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`]));
  let preview: AssetPreviewData | null = null;
  if (selectedId) {
    const a = await ctx.cdb.fixedAsset.findFirst({ where: { id: selectedId }, include: { group: true, location: true } });
    if (a) {
      const state = await assetState(db, companyId, a.id);
      const [lines, events, responsible, invoice] = await Promise.all([
        ctx.cdb.depreciationLine.findMany({ where: { assetId: a.id }, include: { run: { select: { period: true, date: true, journalEntryId: true } } } }),
        ctx.cdb.fixedAssetEvent.findMany({ where: { assetId: a.id } }),
        a.responsibleId ? ctx.cdb.employee.findFirst({ where: { id: a.responsibleId }, select: { name: true } }) : null,
        a.purchaseInvoiceId ? ctx.cdb.purchaseInvoice.findFirst({ where: { id: a.purchaseInvoiceId }, select: { id: true, number: true, supplierName: true } }) : null,
      ]);
      const groupName = new Map(groups.map((g) => [g.id, g.name]));
      const history = [
        ...lines.map((l) => ({
          key: l.id,
          date: toISODate(l.run.date),
          label: l.months > 1 ? t("historyDepreciationMonths", { months: l.months }) : t("historyDepreciation"),
          amount: dec(l.amount).negated().toFixed(2),
          journalId: l.run.journalEntryId,
        })),
        ...events.map((e) => ({
          key: e.id,
          date: toISODate(e.date),
          label:
            e.type === "RECLASSIFICATION"
              ? t("historyReclassification", { from: groupName.get(e.fromGroupId ?? "") ?? "", to: groupName.get(e.toGroupId ?? "") ?? "" })
              : e.type === "REVALUATION" && e.usefulLifeMonths
                ? t("historyRevaluationLife", { months: e.usefulLifeMonths })
                : t(`eventTypes.${e.type}`),
          amount: e.type === "REVALUATION" && !dec(e.costDelta).isZero() ? e.costDelta.toFixed(2) : e.type === "DISPOSAL" ? dec(e.costDelta).plus(dec(e.accumulatedDelta).negated()).toFixed(2) : null,
          journalId: e.journalEntryId,
        })),
      ].sort((x, y) => x.date.localeCompare(y.date));
      const next = monthStart(state.lastDepreciation ? new Date(state.lastDepreciation.getTime() + 86_400_000) : a.depreciationStart);
      const schedule = depreciationSchedule(
        { cost: a.cost, residualValue: a.residualValue, accumulated: state.accumulated, usefulLifeMonths: a.usefulLifeMonths, monthsDone: state.monthsDone, depreciationStart: a.depreciationStart },
        next > monthStart(a.depreciationStart) ? next : monthStart(a.depreciationStart),
        12,
      );
      preview = {
        id: a.id,
        code: a.code,
        name: a.name,
        status: a.status,
        group: a.group.name,
        groupId: a.groupId,
        location: a.location?.name ?? null,
        responsible: responsible?.name ?? null,
        serialNumber: a.serialNumber,
        acquisitionDate: toISODate(a.acquisitionDate),
        depreciationStart: toISODate(a.depreciationStart),
        disposedAt: a.disposedAt ? toISODate(a.disposedAt) : null,
        cost: a.status === "DISPOSED" ? "0.00" : a.cost.toFixed(2),
        residualValue: a.residualValue.toFixed(2),
        accumulated: a.status === "DISPOSED" ? "0.00" : state.accumulated.toFixed(2),
        bookValue: a.status === "DISPOSED" ? "0.00" : dec(a.cost).minus(state.accumulated).toFixed(2),
        usefulLifeMonths: a.usefulLifeMonths,
        monthsDone: state.monthsDone,
        accounts: { asset: accountLabel.get(a.assetAccountId) ?? "", accumulated: accountLabel.get(a.accumulatedAccountId) ?? "", expense: accountLabel.get(a.expenseAccountId) ?? "" },
        purchaseInvoice: invoice ? { id: invoice.id, label: `${invoice.number ?? ""} ${invoice.supplierName}`.trim() } : null,
        notes: a.notes,
        canDelete: !state.hasHistory,
        history,
        schedule: schedule.map((s) => ({ period: toISODate(s.period), amount: s.amount.toFixed(2), bookValue: s.bookValue.toFixed(2) })),
      };
    }
  }

  const canEdit = can(ctx.membership, "assets", "edit");
  const base = `/c/${companyId}/assets`;
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
  const filtered = Boolean(q || groupId || locationId || status !== "ACTIVE");

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tn("items.assets.register")}
        description={t("listSubtitle")}
        actions={
          <>
            <AssetGroupsDialog
              companyId={companyId}
              canEdit={canEdit}
              accounts={accounts}
              groups={groups.map((g) => ({ id: g.id, name: g.name, assetAccountId: g.assetAccountId, accumulatedAccountId: g.accumulatedAccountId, expenseAccountId: g.expenseAccountId, usefulLifeMonths: g.usefulLifeMonths, count: g._count.assets }))}
            />
            <LocationsDialog
              title={t("locations")}
              canEdit={canEdit}
              groups={locations.map((l) => ({ id: l.id, name: l.name, count: l._count.assets }))}
              save={saveAssetLocation.bind(null, companyId)}
              remove={deleteAssetLocation.bind(null, companyId)}
            />
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
        filters={[
          {
            name: "status",
            label: t("status"),
            options: [
              { value: "", label: t("statuses.ACTIVE") },
              { value: "DISPOSED", label: t("statuses.DISPOSED") },
              { value: "all", label: t("allStatuses") },
            ],
          },
          { name: "group", label: t("group"), options: [{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))] },
          ...(locations.length ? [{ name: "location", label: t("location"), options: [{ value: "", label: t("allLocations") }, ...locations.map((l) => ({ value: l.id, label: l.name }))] }] : []),
        ]}
      />
      <div className={cn("mt-4 grid gap-4", preview && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <Card className={cn("overflow-hidden", preview && "hidden lg:block")}>
          {assets.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title={filtered ? t("noResults") : t("emptyTitle")}
              description={filtered ? undefined : t("emptyBody")}
              action={
                canEdit &&
                !filtered && (
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
              {assets.map((a) => {
                const acc = dec(a.openingDepreciation).plus(accBy.get(a.id) ?? 0);
                return (
                  <li key={a.id}>
                    <Link
                      href={link({ doc: a.id })}
                      scroll={false}
                      aria-current={a.id === selectedId ? "true" : undefined}
                      className={cn("flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50", a.id === selectedId && "bg-accent/60 hover:bg-accent/60")}
                    >
                      <div className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{a.code}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{a.name}</span>
                          {a.status === "DISPOSED" && <Badge variant="outline">{t("statuses.DISPOSED")}</Badge>}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {a.group.name}
                          {a.location ? ` · ${a.location.name}` : ""} · {formatDate(a.acquisitionDate, locale)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm tabular-nums">
                        <div className="font-medium">{a.status === "DISPOSED" ? "—" : formatMoney(dec(a.cost).minus(acc), locale)}</div>
                        <div className="text-xs text-muted-foreground">{formatMoney(a.cost, locale)}</div>
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
          <AssetPreview
            companyId={companyId}
            asset={preview}
            closeHref={link({ doc: null })}
            canEdit={canEdit}
            canConfirm={can(ctx.membership, "assets", "confirm")}
            canViewLedger={can(ctx.membership, "finance", "view")}
            today={toISODate(todayLocal())}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))}
            lossAccountId={accounts.find((a) => a.code === "4420")?.id ?? ""}
          />
        )}
      </div>
    </div>
  );
}
