"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { dateSchema, decimalInputSchema, idSchema, optionalDateSchema, optionalIdSchema, optionalText } from "@/lib/validation";
import {
  documentExists,
  readAttachment,
  removeStoredFile,
  storeAttachment,
  type AttachmentDocumentType,
} from "@/server/services/attachments";
import {
  confirmExpenseReport,
  confirmPurchase,
  createPurchaseCredit,
  createUploadDraft,
  deleteExpenseDraft,
  deletePurchaseDraft,
  orderToPurchaseInvoice,
  saveExpenseReport,
  savePurchaseDraft,
  savePurchaseOrder,
} from "@/server/services/purchases";
import type { CompanyContext } from "@/server/session";
import { rateLimit } from "@/lib/rate-limit";
import { AiExtractError, aiExtractInvoice, aiExtractionEnabled } from "@/server/purchases/ai-extract";

const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(fn, { timeout: 20_000 });
const invoicesPath = (companyId: string) => `/c/${companyId}/purchases/invoices`;

const lineSchema = z.object({
  itemId: optionalIdSchema,
  code: optionalText(30),
  description: z.string().trim().max(1000, { error: "tooLong" }),
  quantity: decimalInputSchema(4, { negative: true }),
  unit: optionalText(20),
  unitPrice: decimalInputSchema(4, { negative: true }),
  discountPct: decimalInputSchema(2).refine((v) => Number(v) <= 100, { error: "percent" }),
  vatRateId: optionalIdSchema,
  accountId: optionalIdSchema,
  departmentId: optionalIdSchema,
  dimensionValueIds: z.array(idSchema).max(20).optional(),
});

const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: "currency" });

const invoiceSchema = z.object({
  id: idSchema.optional(),
  isCredit: z.boolean().optional(),
  supplierId: optionalIdSchema,
  invoiceNumber: optionalText(60),
  date: dateSchema,
  dueDate: optionalDateSchema,
  referenceNumber: optionalText(25),
  currency: currencySchema,
  currencyRate: decimalInputSchema(6, { empty: "" }).transform((v) => (v === "" || v === "0" ? null : v)),
  pricesIncludeVat: z.boolean(),
  notes: optionalText(2000),
  warehouseId: optionalIdSchema,
  lines: z.array(lineSchema).max(500),
});

function draftInput(input: z.output<typeof invoiceSchema>) {
  return { ...input, lines: input.lines.map((l) => ({ ...l })) };
}

async function auditDoc(ctx: CompanyContext, action: string, entityType: string, entityId: string, after?: Record<string, unknown>) {
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action, entityType, entityId, after });
}

export const savePurchaseInvoice = companyAction({ module: "purchases", level: "edit", schema: invoiceSchema }, async (input, ctx) => {
  const id = await tx((t) => savePurchaseDraft(t, ctx.company.id, ctx.user.id, draftInput(input)));
  await auditDoc(ctx, input.id ? "purchaseInvoice.updateDraft" : "purchaseInvoice.createDraft", "PurchaseInvoice", id, {
    date: toISODate(input.date),
    invoiceNumber: input.invoiceNumber,
  });
  revalidatePath(invoicesPath(ctx.company.id));
  return { id };
});

export const confirmPurchaseInvoice = companyAction({ module: "purchases", level: "confirm", schema: invoiceSchema }, async (input, ctx) => {
  const result = await tx(async (t) => {
    const id = await savePurchaseDraft(t, ctx.company.id, ctx.user.id, draftInput(input));
    return confirmPurchase(t, ctx.company.id, ctx.user.id, id);
  });
  await auditDoc(ctx, "purchaseInvoice.confirm", "PurchaseInvoice", result.id, { number: result.number });
  revalidatePath(invoicesPath(ctx.company.id));
  return result;
});

const idOnly = z.object({ id: idSchema });
const idAndDate = z.object({ id: idSchema, date: dateSchema });

export const confirmPurchaseInvoiceById = companyAction({ module: "purchases", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const result = await tx((t) => confirmPurchase(t, ctx.company.id, ctx.user.id, id));
  await auditDoc(ctx, "purchaseInvoice.confirm", "PurchaseInvoice", result.id, { number: result.number });
  revalidatePath(invoicesPath(ctx.company.id));
  return result;
});

async function attachmentsOf(ctx: CompanyContext, documentType: AttachmentDocumentType, documentId: string) {
  return ctx.cdb.attachment.findMany({ where: { documentType, documentId }, select: { storage: true, url: true } });
}

export const deletePurchaseInvoice = companyAction({ module: "purchases", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  const files = await attachmentsOf(ctx, "PurchaseInvoice", id);
  await tx((t) => deletePurchaseDraft(t, ctx.company.id, id));
  await Promise.all(files.map(removeStoredFile));
  await auditDoc(ctx, "purchaseInvoice.deleteDraft", "PurchaseInvoice", id);
  revalidatePath(invoicesPath(ctx.company.id));
});

export const creditPurchaseInvoice = companyAction({ module: "purchases", level: "edit", schema: idAndDate }, async ({ id, date }, ctx) => {
  const creditId = await tx((t) => createPurchaseCredit(t, ctx.company.id, ctx.user.id, id, date));
  await auditDoc(ctx, "purchaseInvoice.credit", "PurchaseInvoice", creditId, { creditOf: id });
  revalidatePath(invoicesPath(ctx.company.id));
  return { id: creditId };
});

// --- Manused ja kinnitamata ostuarved ---------------------------------------------

const MODULE_BY_TYPE = {
  PurchaseInvoice: "purchases",
  ExpenseReport: "purchases",
  PurchaseOrder: "purchases",
  SalesInvoice: "sales",
} as const;

const fileSchema = z.instanceof(File);

export const uploadAttachment = companyAction(
  {
    module: "dashboard",
    level: "view",
    schema: z.object({
      documentType: z.enum(["PurchaseInvoice", "ExpenseReport", "PurchaseOrder", "SalesInvoice"]),
      documentId: idSchema,
      file: fileSchema,
    }),
  },
  async ({ documentType, documentId, file }, ctx) => {
    if (!can(ctx.membership, MODULE_BY_TYPE[documentType], "edit")) throw new ActionError("forbidden");
    const attachment = await tx(async (t) => {
      if (!(await documentExists(t, ctx.company.id, documentType, documentId))) throw new ActionError("notFound");
      return storeAttachment(t, ctx.company.id, ctx.user.id, { type: documentType, id: documentId }, file);
    });
    await auditDoc(ctx, "attachment.upload", documentType, documentId, { fileName: attachment.fileName });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
    return { id: attachment.id };
  },
);

export const deleteAttachment = companyAction({ module: "dashboard", level: "view", schema: idOnly }, async ({ id }, ctx) => {
  const attachment = await ctx.cdb.attachment.findFirst({ where: { id }, select: { id: true, documentType: true, documentId: true, storage: true, url: true, fileName: true } });
  if (!attachment) throw new ActionError("notFound");
  const requiredModule = MODULE_BY_TYPE[attachment.documentType as keyof typeof MODULE_BY_TYPE] ?? "purchases";
  if (!can(ctx.membership, requiredModule, "edit")) throw new ActionError("forbidden");
  // Kinnitatud dokumendi manuseid ei kustutata (dokument peab jääma tõendatuks)
  if (attachment.documentType === "PurchaseInvoice") {
    const inv = await ctx.cdb.purchaseInvoice.findFirst({ where: { id: attachment.documentId }, select: { status: true } });
    if (inv?.status === "CONFIRMED") throw new ActionError("attachmentLocked");
  }
  if (attachment.documentType === "ExpenseReport") {
    const rep = await ctx.cdb.expenseReport.findFirst({ where: { id: attachment.documentId }, select: { status: true } });
    if (rep?.status === "CONFIRMED") throw new ActionError("attachmentLocked");
  }
  await ctx.cdb.attachment.delete({ where: { id } });
  await removeStoredFile(attachment);
  await auditDoc(ctx, "attachment.delete", attachment.documentType, attachment.documentId, { fileName: attachment.fileName });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
});

/** Kinnitamata ostuarvete kaust: iga fail saab oma mustandi, mille raamatupidaja täidab ja kinnitab. */
export const uploadPurchaseFiles = companyAction(
  { module: "purchases", level: "edit", schema: z.object({ files: z.array(fileSchema).min(1).max(10) }) },
  async ({ files }, ctx) => {
    const ids: string[] = [];
    for (const file of files) {
      const id = await tx(async (t) => {
        const invoiceId = await createUploadDraft(t, ctx.company.id, ctx.user.id, todayLocal());
        await storeAttachment(t, ctx.company.id, ctx.user.id, { type: "PurchaseInvoice", id: invoiceId }, file);
        return invoiceId;
      });
      ids.push(id);
    }
    await auditDoc(ctx, "purchaseInvoice.upload", "PurchaseInvoice", ids[0]!, { files: files.length });
    revalidatePath(`/c/${ctx.company.id}/purchases/inbox`);
    return { ids };
  },
);

// --- Ostutellimused --------------------------------------------------------------

const orderSchema = z.object({
  id: idSchema.optional(),
  supplierId: idSchema,
  date: dateSchema,
  expectedDate: optionalDateSchema,
  currency: currencySchema,
  pricesIncludeVat: z.boolean(),
  notes: optionalText(2000),
  lines: z.array(lineSchema).max(500),
});

const ordersPath = (companyId: string) => `/c/${companyId}/purchases/orders`;

export const savePurchaseOrderAction = companyAction({ module: "purchases", level: "edit", schema: orderSchema }, async (input, ctx) => {
  const id = await tx((t) => savePurchaseOrder(t, ctx.company.id, ctx.user.id, { ...input, lines: input.lines.map((l) => ({ ...l })) }));
  await auditDoc(ctx, input.id ? "purchaseOrder.update" : "purchaseOrder.create", "PurchaseOrder", id);
  revalidatePath(ordersPath(ctx.company.id));
  return { id };
});

export const setPurchaseOrderStatus = companyAction(
  { module: "purchases", level: "edit", schema: z.object({ id: idSchema, status: z.enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]) }) },
  async ({ id, status }, ctx) => {
    const res = await ctx.cdb.purchaseOrder.updateMany({ where: { id, status: { not: "INVOICED" } }, data: { status } });
    if (res.count !== 1) throw new ActionError("sales.orderInvoiced");
    revalidatePath(ordersPath(ctx.company.id));
  },
);

export const deletePurchaseOrder = companyAction({ module: "purchases", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  const order = await ctx.cdb.purchaseOrder.findFirst({ where: { id }, select: { status: true, number: true } });
  if (!order) throw new ActionError("notFound");
  if (order.status === "INVOICED") throw new ActionError("sales.orderInvoiced");
  await ctx.cdb.purchaseOrder.delete({ where: { id } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "purchaseOrder.delete", entityType: "PurchaseOrder", entityId: id, before: { number: order.number } });
  revalidatePath(ordersPath(ctx.company.id));
});

export const orderToInvoiceAction = companyAction({ module: "purchases", level: "edit", schema: idAndDate }, async ({ id, date }, ctx) => {
  const invoiceId = await tx((t) => orderToPurchaseInvoice(t, ctx.company.id, ctx.user.id, id, date));
  await auditDoc(ctx, "purchaseOrder.toInvoice", "PurchaseOrder", id, { invoiceId });
  revalidatePath(ordersPath(ctx.company.id));
  revalidatePath(invoicesPath(ctx.company.id));
  return { id: invoiceId };
});

// --- Kuluaruanded ------------------------------------------------------------------

const expenseSchema = z.object({
  id: idSchema.optional(),
  employeeId: idSchema,
  date: dateSchema,
  description: optionalText(250),
  lines: z
    .array(
      z.object({
        date: dateSchema,
        vendor: optionalText(120),
        documentNumber: optionalText(60),
        description: z.string().trim().max(500, { error: "tooLong" }),
        accountId: optionalIdSchema,
        vatRateId: optionalIdSchema,
        grossAmount: decimalInputSchema(2, { negative: true }),
        departmentId: optionalIdSchema,
        dimensionValueIds: z.array(idSchema).max(20).optional(),
      }),
    )
    .max(300),
});

const expensesPath = (companyId: string) => `/c/${companyId}/purchases/expenses`;

export const saveExpenseReportAction = companyAction({ module: "purchases", level: "edit", schema: expenseSchema }, async (input, ctx) => {
  const id = await tx((t) => saveExpenseReport(t, ctx.company.id, ctx.user.id, { ...input, lines: input.lines.map((l) => ({ ...l })) }));
  await auditDoc(ctx, input.id ? "expenseReport.update" : "expenseReport.create", "ExpenseReport", id);
  revalidatePath(expensesPath(ctx.company.id));
  return { id };
});

export const confirmExpenseReportAction = companyAction({ module: "purchases", level: "confirm", schema: expenseSchema }, async (input, ctx) => {
  const result = await tx(async (t) => {
    const id = await saveExpenseReport(t, ctx.company.id, ctx.user.id, { ...input, lines: input.lines.map((l) => ({ ...l })) });
    return confirmExpenseReport(t, ctx.company.id, ctx.user.id, id);
  });
  await auditDoc(ctx, "expenseReport.confirm", "ExpenseReport", result.id, { number: result.number });
  revalidatePath(expensesPath(ctx.company.id));
  return result;
});

export const confirmExpenseReportById = companyAction({ module: "purchases", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const result = await tx((t) => confirmExpenseReport(t, ctx.company.id, ctx.user.id, id));
  await auditDoc(ctx, "expenseReport.confirm", "ExpenseReport", result.id, { number: result.number });
  revalidatePath(expensesPath(ctx.company.id));
  return result;
});

export const deleteExpenseReport = companyAction({ module: "purchases", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  const files = await attachmentsOf(ctx, "ExpenseReport", id);
  await tx((t) => deleteExpenseDraft(t, ctx.company.id, id));
  await Promise.all(files.map(removeStoredFile));
  await auditDoc(ctx, "expenseReport.deleteDraft", "ExpenseReport", id);
  revalidatePath(expensesPath(ctx.company.id));
});

// --- AI-tuvastus (valikuline) ---------------------------------------------------

/**
 * Ostuarve andmete tuvastus failist Claude'iga: salvestatud manus (attachmentId) või uue arve
 * veel salvestamata fail. Piirang 200 tuvastust päevas ettevõtte kohta.
 */
export const aiExtractPurchaseAction = companyAction(
  {
    module: "purchases",
    level: "edit",
    schema: z.object({ attachmentId: idSchema.optional(), file: fileSchema.optional() }),
  },
  async (input, ctx) => {
    if (!aiExtractionEnabled()) throw new ActionError("aiNotConfigured");
    const limited = await rateLimit(`ai:${ctx.company.id}`, 200, 86_400);
    if (!limited.ok) throw new ActionError("rateLimited");
    let bytes: Buffer | null = null;
    let mediaType = "";
    if (input.attachmentId) {
      const a = await ctx.cdb.attachment.findFirst({
        where: { id: input.attachmentId, documentType: "PurchaseInvoice" },
        select: { storage: true, url: true, data: true, contentType: true },
      });
      if (!a) throw new ActionError("notFound");
      bytes = await readAttachment(a);
      mediaType = a.contentType;
    } else if (input.file) {
      if (input.file.size > 4 * 1024 * 1024) throw new ActionError("sales.attachmentTooLarge");
      bytes = Buffer.from(await input.file.arrayBuffer());
      mediaType = input.file.type;
    }
    if (!bytes) throw new ActionError("notFound");
    const company = await ctx.cdb.company.findFirstOrThrow({ select: { name: true, regCode: true } });
    const items = await ctx.cdb.item.findMany({ where: { active: true, forPurchases: true }, orderBy: { code: "asc" }, take: 300, select: { code: true, name: true } });
    try {
      return await aiExtractInvoice({ bytes, mediaType, buyer: company, items });
    } catch (e) {
      if (e instanceof AiExtractError) throw new ActionError(e.code);
      throw e;
    }
  },
);
