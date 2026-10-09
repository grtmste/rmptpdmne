import { db } from "@/lib/db";
import { loadCompanyContext } from "@/server/session";
import { can } from "@/lib/permissions";
import { paymentOrderXml } from "@/server/services/bank";

export const runtime = "nodejs";

/** Maksekorralduste fail (pain.001) panka üleslaadimiseks. */
export async function GET(_request: Request, ctx: RouteContext<"/c/[companyId]/payments/orders/[orderId]/xml">) {
  const { companyId, orderId } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company || !can(company.membership, "payments", "view")) return new Response("Not found", { status: 404 });
  try {
    const { fileName, xml } = await db.$transaction((tx) => paymentOrderXml(tx, companyId, orderId));
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
