import type { NextRequest } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { csvAmount, toCsv } from "@/lib/csv";
import { toISODate } from "@/lib/accounting/dates";
import { loadCompanyContext } from "@/server/session";
import { dayBook, generalLedger, trialBalance } from "@/server/reports/ledger";
import { balanceSheet, cashFlow, incomeStatement } from "@/server/reports/financial";
import type { StatementRow } from "@/lib/reports/statements";
import { parseISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";

const STATEMENTS = new Set(["balance-sheet", "income-statement", "cash-flow"]);
import { parseReportQuery } from "../../report-params";

/** Pearaamatu aruannete CSV eksport (sama filtrid nagu vaates). */
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[companyId]/finance/export/[report]">) {
  const { companyId, report } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company || !can(company.membership, STATEMENTS.has(report) ? "reports" : "finance", "view")) return new Response("Not found", { status: 404 });

  const sp: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const all = request.nextUrl.searchParams.getAll(key);
    sp[key] = all.length > 1 ? all : all[0]!;
  }
  const q = await parseReportQuery(company, sp);
  const locale = await getLocale();
  const t = await getTranslations("reports");
  const a = (v: Parameters<typeof csvAmount>[0]) => csvAmount(v, locale);
  const rows: Array<Array<string | number | null>> = [];
  const tl = await getTranslations("reportLines");
  const statementRows = (list: StatementRow[], withCompare: boolean) => {
    for (const r of list) {
      if (r.kind === "heading") rows.push([tl(r.code)]);
      else rows.push([tl(r.code), a(r.amount), ...(withCompare ? [r.compare ? a(r.compare) : ""] : [])]);
    }
  };
  const flag = (key: string) => request.nextUrl.searchParams.get(key);

  if (report === "balance-sheet") {
    const date = parseISODate(flag("to") ?? "") ?? todayLocal();
    const bs = await balanceSheet(db, companyId, { date, compare: flag("compare") !== "0" });
    rows.push(["", toISODate(date), ...(bs.compareDate ? [toISODate(bs.compareDate)] : [])]);
    statementRows(bs.rows, Boolean(bs.compareDate));
  } else if (report === "income-statement") {
    const scheme = flag("scheme") === "2" ? 2 : 1;
    const is = await incomeStatement(db, companyId, {
      from: q.from,
      to: q.to,
      scheme,
      compare: flag("compare") !== "0",
      departmentId: q.departmentId,
      dimensionValueId: q.dimensionValueId,
    });
    rows.push(["", `${q.fromIso}…${q.toIso}`, ...(is.compare ? [`${toISODate(is.compare.from)}…${toISODate(is.compare.to)}`] : [])]);
    statementRows(is.rows, Boolean(is.compare));
  } else if (report === "cash-flow") {
    const cf = await cashFlow(db, companyId, { from: q.from, to: q.to });
    rows.push(["", `${q.fromIso}…${q.toIso}`]);
    statementRows(cf.rows, false);
  } else if (report === "trial-balance") {
    const tb = await trialBalance(db, companyId, q);
    rows.push([t("code"), t("name"), `${t("opening")} ${t("debit")}`, `${t("opening")} ${t("credit")}`, t("debit"), t("credit"), `${t("closing")} ${t("debit")}`, `${t("closing")} ${t("credit")}`]);
    for (const r of tb.rows) {
      rows.push([
        r.code,
        r.name,
        r.opening.isPositive() ? a(r.opening) : "",
        r.opening.isNegative() ? a(r.opening.negated()) : "",
        a(r.debit),
        a(r.credit),
        r.closing.isPositive() ? a(r.closing) : "",
        r.closing.isNegative() ? a(r.closing.negated()) : "",
      ]);
    }
    rows.push([t("total"), "", a(tb.totals.openingDebit), a(tb.totals.openingCredit), a(tb.totals.debit), a(tb.totals.credit), a(tb.totals.closingDebit), a(tb.totals.closingCredit)]);
  } else if (report === "ledger") {
    const gl = await generalLedger(db, companyId, q, 50_000);
    rows.push([t("code"), t("name"), t("date"), t("entry"), t("description"), t("debit"), t("credit"), t("balance")]);
    for (const acc of gl.accounts) {
      rows.push([acc.code, acc.name, toISODate(q.from), "", t("openingBalance"), "", "", a(acc.opening)]);
      for (const l of acc.lines) {
        rows.push([acc.code, acc.name, toISODate(l.date), l.number, l.description ?? "", a(l.debit), a(l.credit), a(l.balance)]);
      }
    }
  } else if (report === "daybook") {
    const book = await dayBook(db, companyId, q, 1, 100_000);
    rows.push([t("date"), t("entry"), t("description"), t("code"), t("name"), t("debit"), t("credit")]);
    for (const e of book.entries) {
      for (const l of e.lines) {
        rows.push([toISODate(e.date), e.number, l.description || e.description || "", l.account.code, l.account.name, a(l.debit.toString()), a(l.credit.toString())]);
      }
    }
  } else {
    return new Response("Not found", { status: 404 });
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}_${q.fromIso}_${q.toIso}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
