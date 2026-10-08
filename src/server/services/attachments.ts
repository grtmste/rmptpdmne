import "server-only";
import { put, del } from "@vercel/blob";
import type { Prisma } from "@/generated/prisma/client";
import { SalesError } from "./sales";

type Tx = Prisma.TransactionClient;

/**
 * Dokumentide manused. Tootmises Vercel Blob (BLOB_READ_WRITE_TOKEN); kui seda pole
 * seadistatud (arendus, testid, väike paigaldus), hoitakse fail andmebaasis.
 * Faili aadressi kasutajale ei näidata – allalaadimine käib õigusi kontrolliva marsruudi kaudu.
 */

export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

export const ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/xml",
  "text/xml",
] as const;

export type AttachmentDocumentType = "PurchaseInvoice" | "ExpenseReport" | "SalesInvoice" | "PurchaseOrder";

export function validateAttachment(file: { size: number; type: string }) {
  if (file.size > ATTACHMENT_MAX_BYTES) throw new SalesError("attachmentTooLarge");
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new SalesError("attachmentType");
}

/** Kas dokument kuulub ettevõttele (manust ei seota võõra dokumendiga). */
export async function documentExists(tx: Tx, companyId: string, type: AttachmentDocumentType, id: string) {
  const where = { companyId, id };
  switch (type) {
    case "PurchaseInvoice":
      return (await tx.purchaseInvoice.count({ where })) > 0;
    case "ExpenseReport":
      return (await tx.expenseReport.count({ where })) > 0;
    case "SalesInvoice":
      return (await tx.salesInvoice.count({ where })) > 0;
    case "PurchaseOrder":
      return (await tx.purchaseOrder.count({ where })) > 0;
  }
}

function safeName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120);
  return cleaned || "fail";
}

export async function storeAttachment(
  tx: Tx,
  companyId: string,
  userId: string | null,
  doc: { type: AttachmentDocumentType; id: string },
  file: File,
) {
  validateAttachment(file);
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = safeName(file.name);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`attachments/${companyId}/${fileName}`, bytes, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });
    return tx.attachment.create({
      data: {
        companyId,
        documentType: doc.type,
        documentId: doc.id,
        fileName,
        contentType: file.type,
        size: bytes.length,
        storage: "BLOB",
        url: blob.url,
        uploadedById: userId,
      },
    });
  }
  return tx.attachment.create({
    data: {
      companyId,
      documentType: doc.type,
      documentId: doc.id,
      fileName,
      contentType: file.type,
      size: bytes.length,
      storage: "DATABASE",
      data: bytes,
      uploadedById: userId,
    },
  });
}

/** Faili sisu allalaadimiseks. */
export async function readAttachment(attachment: { storage: "BLOB" | "DATABASE"; url: string | null; data: Uint8Array | null }) {
  if (attachment.storage === "DATABASE") return attachment.data ? Buffer.from(attachment.data) : null;
  if (!attachment.url) return null;
  const res = await fetch(attachment.url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function removeStoredFile(attachment: { storage: "BLOB" | "DATABASE"; url: string | null }) {
  if (attachment.storage === "BLOB" && attachment.url && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(attachment.url).catch(() => undefined);
  }
}
