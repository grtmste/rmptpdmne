import "server-only";
import { db } from "@/lib/db";
import { emailDefaults } from "./email-defaults";
import { invoicePdf } from "./documents";
import { deliverDocument, splitEmails, type DeliveryResult } from "./mailer";

/**
 * Kinnitatud arve saatmine kliendile vaikimisi tekstiga (perioodilised arved, ajastatud tööd).
 * Kliendi e-posti puudumisel tagastab vea `noEmail`.
 */
export async function sendInvoiceAutomatically(companyId: string, invoiceId: string, userId: string | null): Promise<DeliveryResult | { ok: false; error: "noEmail" }> {
  const pdf = await invoicePdf(companyId, invoiceId);
  if (!pdf) return { ok: false, error: "emailFailed" };
  const customer = await db.customer.findFirst({ where: { companyId, id: pdf.invoice.customerId }, select: { email: true, emailCc: true } });
  const draft = await emailDefaults(companyId, pdf.invoice, customer);
  if (!draft.to) return { ok: false, error: "noEmail" };
  const res = await deliverDocument({
    companyId,
    userId,
    documentType: "SalesInvoice",
    documentId: invoiceId,
    to: draft.to,
    cc: splitEmails(draft.cc),
    subject: draft.subject,
    body: draft.body,
    attachment: { filename: pdf.filename, content: pdf.buffer },
  });
  if (res.ok) await db.salesInvoice.update({ where: { id: invoiceId }, data: { sentAt: new Date() } });
  return res;
}
