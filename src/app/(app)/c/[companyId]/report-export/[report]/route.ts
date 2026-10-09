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
