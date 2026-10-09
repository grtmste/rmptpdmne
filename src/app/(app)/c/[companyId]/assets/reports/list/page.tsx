import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PackageOpen } from "lucide-react";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/session";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { assetList } from "@/server/reports/assets";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ReportBar } from "@/components/reports/report-bar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("items.assets.listReport") };
}

export default async function AssetListReport({ params, searchParams }: PageProps<"/c/[companyId]/assets/reports/list">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(companyId, "reports");
  const t = await getTranslations("assets");
  const tr = await getTranslations("reports");
  const tn = await getTranslations("nav");
  const locale = await getLocale();
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const date = parseISODate(str(sp.to)) ?? todayLocal();
  const [groups, locations, employees] = await Promise.all([
    ctx.cdb.fixedAssetGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.fixedAssetLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.cdb.employee.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pick = (v: string, list: Array<{ id: string }>) => (list.some((x) => x.id === v) ? v : "");
  const group = pick(str(sp.group), groups);
  const location = pick(str(sp.location), locations);
  const responsible = pick(str(sp.responsible), employees);
  const disposed = str(sp.disposed) === "1";
  const r = await assetList(db, companyId, { date, groupId: group || null, locationId: location || null, responsibleId: responsible || null, includeDisposed: disposed });
  const person = new Map(employees.map((e) => [e.id, e.name]));
  const qs = new URLSearchParams({ to: toISODate(date), ...(group ? { group } : {}), ...(location ? { location } : {}), ...(responsible ? { responsible } : {}), ...(disposed ? { disposed: "1" } : {}) });
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, locale);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader title={tn("items.assets.listReport")} description={t("asOfLabel", { date: formatDate(date, locale) })} />
      <ReportBar
        fields={[
          { key: "to", label: tr("asOf"), type: "date" },
          { key: "group", label: t("group"), type: "select", options: [{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name }))] },
          { key: "location", label: t("location"), type: "select", options: [{ value: "", label: t("allLocations") }, ...locations.map((g) => ({ value: g.id, label: g.name }))] },
          { key: "responsible", label: t("responsible"), type: "select", options: [{ value: "", label: t("allResponsible") }, ...employees.map((g) => ({ value: g.id, label: g.name }))] },
          { key: "disposed", label: t("includeDisposed"), type: "check" },
        ]}
        initial={{ to: toISODate(date), group, location, responsible, disposed: disposed ? "1" : "" }}
        exportHref={`/c/${companyId}/report-export/assets?${qs}`}
      />
      <Card className="overflow-hidden">
        {r.rows.length === 0 ? (
          <EmptyState icon={PackageOpen} title={t("noAssetsTitle")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="asset-list">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t("asset")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("group")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium lg:table-cell">{t("location")}</th>
                  <th className="hidden px-3 py-2 text-left font-medium lg:table-cell">{t("responsible")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("acquisitionDate")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("cost")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("accumulated")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("bookValue")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.rows.map((x) => (
                  <tr key={x.id} className="hover:bg-muted/40">
                    <td className="px-4 py-1.5">
                      <Link className="hover:underline" href={`/c/${companyId}/assets?doc=${x.id}`}>
                        <span className="font-mono text-xs text-muted-foreground">{x.code}</span> {x.name}
                      </Link>
                      {x.status === "DISPOSED" && (
                        <Badge variant="outline" className="ml-2">
                          {t("statuses.DISPOSED")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{x.group}</td>
                    <td className="hidden px-3 py-1.5 lg:table-cell">{x.location ?? "—"}</td>
                    <td className="hidden px-3 py-1.5 lg:table-cell">{x.responsibleId ? person.get(x.responsibleId) : "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(x.acquisitionDate, locale)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.cost)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m(x.accumulated)}</td>
                    <td className="px-4 py-1.5 text-right font-medium tabular-nums">{m(x.bookValue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t font-semibold">
                <tr>
                  <td className="px-4 py-2" colSpan={3}>
                    {t("total")}
                  </td>
                  <td className="hidden lg:table-cell" colSpan={2} />
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(r.totals.accumulated)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{m(r.totals.bookValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
