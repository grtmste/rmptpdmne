import { loadCompanyContext } from "@/server/session";
import { can } from "@/lib/permissions";
import { invoicePdf } from "@/server/sales/documents";

export const runtime = "nodejs";

/** Arve PDF (mustandil ilma numbrita). ?download=1 laeb alla, muidu avab brauseris. */
export async function GET(request: Request, ctx: RouteContext<"/c/[companyId]/sales/invoices/[invoiceId]/pdf">) {
  const { companyId, invoiceId } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company || !can(company.membership, "sales", "view")) return new Response("Not found", { status: 404 });
  const pdf = await invoicePdf(companyId, invoiceId);
  if (!pdf) return new Response("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
