import type { NextRequest } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { csvAmount, toCsv } from "@/lib/csv";
import { toISODate } from "@/lib/accounting/dates";
import { AGING_BUCKETS } from "@/lib/reports/aging";
import { loadCompanyContext } from "@/server/session";
import { purchaseReport, salesReport } from "@/server/reports/documents";
import { debtsAsOf, partyTurnover } from "@/server/reports/debts";
import { stockAnalysis, stockBalance, stockTurnover } from "@/server/reports/inventory";
import { assetList, assetSummary, depreciationReport } from "@/server/reports/assets";
import { parseISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { parseDocReportQuery } from "@/components/reports/params";

const SALES_GROUPS = ["invoice", "customer", "item", "month"] as const;
const PURCHASE_GROUPS = ["invoice", "supplier", "account", "month"] as const;

/** Müügi-, ostu- ja võlgnevusaruannete CSV (samad filtrid nagu vaates). */
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[companyId]/report-export/[report]">) {
  const { companyId, report } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company || !can(company.membership, "reports", "view")) return new Response("Not found", { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const locale = await getLocale();
  const t = await getTranslations("docReports");
  const td = await getTranslations("debts");
  const tv = await getTranslations("inventory");
  const ta = await getTranslations("assets");
  const a = (v: Parameters<typeof csvAmount>[0]) => csvAmount(v, locale);
  const rows: Array<Array<string | number | null>> = [];
  let suffix = "";

  if (report === "sales" || report === "purchases") {
    const isSales = report === "sales";
    const q = isSales
      ? await parseDocReportQuery(companyId, sp, SALES_GROUPS, "customer")
      : await parseDocReportQuery(companyId, sp, PURCHASE_GROUPS, "supplier");
    const r = isSales
      ? await salesReport(db, companyId, { from: q.from, to: q.to, group: q.group as (typeof SALES_GROUPS)[number], search: q.search })
      : await purchaseReport(db, companyId, { from: q.from, to: q.to, group: q.group as (typeof PURCHASE_GROUPS)[number], search: q.search });
    rows.push([t(isSales ? `salesGroups.${q.group}` : `purchaseGroups.${q.group}`), "", t("count"), t("quantity"), t("net"), t("vat"), t("total")]);
    for (const x of r.rows) rows.push([x.label, x.sub ?? "", x.count, x.quantity ? x.quantity.toString() : "", a(x.net), a(x.vat), a(x.total)]);
    rows.push([t("totalRow"), "", "", "", a(r.totals.net), a(r.totals.vat), a(r.totals.total)]);
    suffix = `${q.fromIso}_${q.toIso}`;
  } else if (report === "receivables" || report === "payables") {
    const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
    if (q.mode === "turnover") {
      const r = await partyTurnover(db, companyId, report, q.from, q.to, q.search);
      rows.push([td("party"), td("opening"), report === "receivables" ? td("invoicedSales") : td("invoicedPurchases"), td("paid"), td("closing")]);
      for (const x of r.rows) rows.push([x.partyName, a(x.opening), a(x.invoiced), a(x.paid), a(x.closing)]);
      rows.push([td("totalRow"), a(r.totals.opening), a(r.totals.invoiced), a(r.totals.paid), a(r.totals.closing)]);
      suffix = `${q.fromIso}_${q.toIso}`;
    } else {
      const r = await debtsAsOf(db, companyId, report, q.to, q.search);
      rows.push([td("party"), td("document"), td("date"), td("dueDate"), ...AGING_BUCKETS.map((b) => td(`buckets.${b}`)), td("prepayment"), td("total")]);
      for (const p of r.rows) {
        for (const d of p.documents) {
          rows.push([p.partyName, d.number, toISODate(d.date), toISODate(d.dueDate), ...AGING_BUCKETS.map(() => ""), "", a(d.openBase)]);
        }
        rows.push([p.partyName, "", "", "", ...AGING_BUCKETS.map((b) => a(p.buckets[b])), a(p.prepayment), a(p.total)]);
      }
      rows.push([td("totalRow"), "", "", "", ...AGING_BUCKETS.map((b) => a(r.totals.buckets[b])), a(r.totals.prepayment), a(r.totals.total)]);
      suffix = q.toIso;
    }
  } else if (report === "stock") {
    const date = parseISODate(sp.to ?? "") ?? todayLocal();
    const warehouse = sp.warehouse ? ((await db.warehouse.findFirst({ where: { companyId, id: sp.warehouse }, select: { id: true } }))?.id ?? null) : null;
    const r = await stockBalance(db, companyId, { date, warehouseId: warehouse, includeZero: sp.zero === "1" });
    rows.push([tv("code"), tv("item"), tv("unit"), tv("quantity"), tv("unitCost"), tv("value")]);
    for (const x of r.rows) rows.push([x.code, x.name, x.unit ?? "", x.quantity.toString(), csvAmount(x.unitCost.toDecimalPlaces(4), locale), a(x.value)]);
    rows.push([tv("totalValue"), "", "", "", "", a(r.total)]);
    suffix = toISODate(date);
  } else if (report === "stock-turnover" || report === "stock-analysis") {
    const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
    if (report === "stock-turnover") {
      const warehouse = sp.warehouse ? ((await db.warehouse.findFirst({ where: { companyId, id: sp.warehouse }, select: { id: true } }))?.id ?? null) : null;
      const r = await stockTurnover(db, companyId, { from: q.from, to: q.to, warehouseId: warehouse });
      const h = (k: string) => [`${tv(k)} ${tv("quantity")}`, `${tv(k)} ${tv("value")}`];
      rows.push([tv("code"), tv("item"), ...h("opening"), ...h("in"), ...h("out"), ...h("closing")]);
      for (const x of r.rows) {
        rows.push([x.code, x.name, x.openingQty.toString(), a(x.openingValue), x.inQty.toString(), a(x.inValue), x.outQty.toString(), a(x.outValue), x.closingQty.toString(), a(x.closingValue)]);
      }
      rows.push([tv("total"), "", "", a(r.totals.openingValue), "", a(r.totals.inValue), "", a(r.totals.outValue), "", a(r.totals.closingValue)]);
    } else {
      const r = await stockAnalysis(db, companyId, { from: q.from, to: q.to });
      rows.push([tv("code"), tv("item"), tv("soldQuantity"), tv("revenue"), tv("cost"), tv("margin"), tv("marginPct")]);
      for (const x of r.rows) rows.push([x.code, x.name, x.quantity.toString(), a(x.revenue), a(x.cost), a(x.margin), x.marginPct ? csvAmount(x.marginPct.toDecimalPlaces(1), locale) : ""]);
      rows.push([tv("total"), "", "", a(r.totals.revenue), a(r.totals.cost), a(r.totals.margin), r.totals.marginPct ? csvAmount(r.totals.marginPct.toDecimalPlaces(1), locale) : ""]);
    }
    suffix = `${q.fromIso}_${q.toIso}`;
  } else if (report === "assets") {
    const date = parseISODate(sp.to ?? "") ?? todayLocal();
    // Filtrid ainult selle ettevõtte kirjetest
    const [group, location, person] = await Promise.all([
      sp.group ? db.fixedAssetGroup.findFirst({ where: { companyId, id: sp.group }, select: { id: true } }) : null,
      sp.location ? db.fixedAssetLocation.findFirst({ where: { companyId, id: sp.location }, select: { id: true } }) : null,
      sp.responsible ? db.employee.findFirst({ where: { companyId, id: sp.responsible }, select: { id: true } }) : null,
    ]);
    const r = await assetList(db, companyId, {
      date,
      groupId: group?.id ?? null,
      locationId: location?.id ?? null,
      responsibleId: person?.id ?? null,
      includeDisposed: sp.disposed === "1",
    });
    rows.push([ta("code"), ta("name"), ta("group"), ta("location"), ta("acquisitionDate"), ta("cost"), ta("accumulated"), ta("bookValue")]);
    for (const x of r.rows) rows.push([x.code, x.name, x.group, x.location ?? "", toISODate(x.acquisitionDate), a(x.cost), a(x.accumulated), a(x.bookValue)]);
    rows.push([ta("total"), "", "", "", "", a(r.totals.cost), a(r.totals.accumulated), a(r.totals.bookValue)]);
    suffix = toISODate(date);
  } else if (report === "asset-depreciation" || report === "asset-summary") {
    const q = await parseDocReportQuery(companyId, sp, ["none"] as const, "none");
    if (report === "asset-depreciation") {
      const group = sp.group ? ((await db.fixedAssetGroup.findFirst({ where: { companyId, id: sp.group }, select: { id: true } }))?.id ?? null) : null;
      const r = await depreciationReport(db, companyId, { from: q.from, to: q.to, groupId: group });
      rows.push([ta("code"), ta("name"), ta("group"), ta("cost"), ta("periodDepreciation"), ta("accumulated"), ta("bookValue")]);
      for (const x of r.rows) rows.push([x.code, x.name, x.group, a(x.cost), a(x.amount), a(x.accumulated), a(x.bookValue)]);
      rows.push([ta("total"), "", "", "", a(r.total), "", ""]);
    } else {
      const r = await assetSummary(db, companyId, { from: q.from, to: q.to });
      const keys = ["openingCost", "additions", "revaluations", "disposals", "closingCost", "openingAccumulated", "depreciation", "accumulatedDisposals", "closingAccumulated", "openingBookValue", "closingBookValue"] as const;
      rows.push(["", ...r.rows.map((g) => g.group), ta("total")]);
      for (const k of keys) rows.push([ta(`summary.${k}`), ...r.rows.map((g) => a(g[k])), a(r.totals[k])]);
    }
    suffix = `${q.fromIso}_${q.toIso}`;
  } else {
    return new Response("Not found", { status: 404 });
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}_${suffix}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
