import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { loadCompanyContext } from "@/server/session";
import { statementCandidates, statementPdf } from "@/server/sales/statements";
import { parseReminderQuery } from "../params";

/** Meeldetuletuse või saldoteatise PDF ühele kliendile (eelvaade enne saatmist). */
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[companyId]/sales/reminders/pdf">) {
  const { companyId } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company || !can(company.membership, "sales", "view")) return new Response("Not found", { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const q = parseReminderQuery(sp);
  const entry = (await statementCandidates(companyId, q.kind, q.asOf, q.days)).find((c) => c.customerId === sp.customer);
  if (!entry) return new Response("Not found", { status: 404 });
  const pdf = await statementPdf(companyId, q.kind, entry, q.asOf);
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(pdf.filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
