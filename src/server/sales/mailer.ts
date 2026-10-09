import "server-only";
import { db } from "@/lib/db";
import { EmailNotConfiguredError, sendDocumentEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

export type DeliveryResult = { ok: true } | { ok: false; error: "rateLimited" | "emailNotConfigured" | "emailFailed" };

/**
 * Dokumendi saatmine kliendile PDF-manusega ja kirje saatmise logisse. Kasutavad nii kasutaja
 * toimingud kui ka ajastatud tööd (perioodilised arved). Kuni 60 kirja tunnis ettevõtte kohta.
 */
export async function deliverDocument(opts: {
  companyId: string;
  userId: string | null;
  documentType: string;
  documentId: string;
  to: string;
  cc: string[];
  subject: string;
  body: string;
  attachment: { filename: string; content: Buffer };
  replyTo?: string | null;
}): Promise<DeliveryResult> {
  const limited = await rateLimit(`email:${opts.companyId}`, 60, 3600);
  if (!limited.ok) return { ok: false, error: "rateLimited" };
  const company = await db.company.findUniqueOrThrow({ where: { id: opts.companyId }, select: { name: true, email: true } });
  let providerId: string | null = null;
  let error: string | null = null;
  try {
    providerId = await sendDocumentEmail({
      to: opts.to,
      cc: opts.cc,
      replyTo: company.email ?? opts.replyTo ?? null,
      subject: opts.subject,
      body: opts.body,
      companyName: company.name,
      attachment: opts.attachment,
    });
  } catch (e) {
    if (e instanceof EmailNotConfiguredError) return { ok: false, error: "emailNotConfigured" };
    error = e instanceof Error ? e.message.slice(0, 500) : "unknown";
  }
  await db.emailLog.create({
    data: {
      companyId: opts.companyId,
      documentType: opts.documentType,
      documentId: opts.documentId,
      to: opts.to,
      cc: opts.cc.join(", ") || null,
      subject: opts.subject,
      status: error ? "FAILED" : "SENT",
      error,
      providerId,
      sentById: opts.userId,
    },
  });
  return error ? { ok: false, error: "emailFailed" } : { ok: true };
}

/** Komaga eraldatud aadressid listiks. */
export const splitEmails = (v: string | null | undefined) =>
  (v ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
