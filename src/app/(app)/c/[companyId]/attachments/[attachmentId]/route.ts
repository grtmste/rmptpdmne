import { loadCompanyContext } from "@/server/session";
import { can } from "@/lib/permissions";
import { readAttachment } from "@/server/services/attachments";

export const runtime = "nodejs";

const MODULE_BY_TYPE: Record<string, "sales" | "purchases"> = {
  PurchaseInvoice: "purchases",
  ExpenseReport: "purchases",
  PurchaseOrder: "purchases",
  SalesInvoice: "sales",
};

/** Manuse allalaadimine/vaatamine õiguste kontrolliga (faili tegelikku aadressi ei avaldata). */
export async function GET(request: Request, ctx: RouteContext<"/c/[companyId]/attachments/[attachmentId]">) {
  const { companyId, attachmentId } = await ctx.params;
  const company = await loadCompanyContext(companyId);
  if (!company) return new Response("Not found", { status: 404 });
  const attachment = await company.cdb.attachment.findFirst({ where: { id: attachmentId } });
  if (!attachment || !can(company.membership, MODULE_BY_TYPE[attachment.documentType] ?? "purchases", "view")) {
    return new Response("Not found", { status: 404 });
  }
  const body = await readAttachment(attachment);
  if (!body) return new Response("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${attachment.fileName}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      // XML-i sees olevad skriptid ei tohi rakenduse nimel käivituda (PDF-i vaatajat see ei puuduta)
      ...(attachment.contentType.includes("xml") ? { "Content-Security-Policy": "default-src 'none'; sandbox" } : {}),
    },
  });
}
