import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { loadCompanyContext } from "@/server/session";
import { vatReturn } from "@/server/reports/vat";
import { buildKmdXml } from "@/lib/vat/kmd";
import { parseVatQuery } from "../vat-params";

/** KMD + KMD INF e-MTA XML-failina. */
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[companyId]/finance/vat/xml">) {
  const { companyId } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company || !can(company.membership, "finance", "view")) return new Response("Not found", { status: 404 });
  const q = parseVatQuery(Object.fromEntries(request.nextUrl.searchParams));
  const r = await vatReturn(db, companyId, q);
  const xml = buildKmdXml({
    regCode: company.company.regCode ?? "",
    year: q.year,
    month: q.month,
    periodStart: r.from,
    kmd: r.kmd,
    partA: r.partA,
    partB: r.partB,
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="KMD_${q.period}.xml"`,
      "Cache-Control": "no-store",
    },
  });
}
