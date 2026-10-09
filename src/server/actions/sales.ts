"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { toISODate } from "@/lib/accounting/dates";
import { deliverDocument } from "@/server/sales/mailer";
import {
  dateSchema,
  decimalInputSchema,
  emailSchema,
  idSchema,
  optionalDateSchema,
  optionalIdSchema,
  optionalText,
  requiredText,
} from "@/lib/validation";
import {
  confirmInvoice,
  copyInvoice,
  createCreditDraft,
  createTaxFreeDraft,
  deleteInvoiceDraft,
  quoteToInvoice,
  saveInvoiceDraft,
  saveQuote,
  type SalesLineInput,
} from "@/server/services/sales";
import { invoicePdf, quotePdf } from "@/server/sales/documents";
import type { CompanyContext } from "@/server/session";
import { currencySchema, lineSchema } from "./sales-schemas";

const invoiceSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(["INVOICE", "CREDIT", "PREPAYMENT"]),
  customerId: idSchema,
  date: dateSchema,
  dueDate: optionalDateSchema,
  deliveryDate: optionalDateSchema,
  currency: currencySchema,
  currencyRate: decimalInputSchema(6, { empty: "" }).transform((v) => (v === "" || v === "0" ? null : v)),
  pricesIncludeVat: z.boolean(),
  yourReference: optionalText(100),
  notes: optionalText(2000),
  warehouseId: optionalIdSchema,
  creditOfId: optionalIdSchema,
  lines: z.array(lineSchema).max(500),
});

const toLines = (lines: z.output<typeof lineSchema>[]): SalesLineInput[] => lines.map((l) => ({ ...l }));

const invoicesPath = (companyId: string) => `/c/${companyId}/sales/invoices`;
const quotesPath = (companyId: string) => `/c/${companyId}/sales/quotes`;
const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(fn, { timeout: 20_000 });

function draftInput(input: z.output<typeof invoiceSchema>) {
  return {
    id: input.id,
    type: input.type,
    customerId: input.customerId,
    date: input.date,
    dueDate: input.dueDate,
    deliveryDate: input.deliveryDate,
    currency: input.currency,
    currencyRate: input.currencyRate,
    pricesIncludeVat: input.pricesIncludeVat,
    yourReference: input.yourReference,
    notes: input.notes,
    warehouseId: input.warehouseId,
    creditOfId: input.creditOfId,
    lines: toLines(input.lines),
  };
}

export const saveSalesInvoice = companyAction({ module: "sales", level: "edit", schema: invoiceSchema }, async (input, ctx) => {
  const id = await tx((t) => saveInvoiceDraft(t, ctx.company.id, ctx.user.id, draftInput(input)));
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "salesInvoice.updateDraft" : "salesInvoice.createDraft",
    entityType: "SalesInvoice",
    entityId: id,
    after: { type: input.type, date: toISODate(input.date), lines: input.lines.length },
  });
  revalidatePath(invoicesPath(ctx.company.id));
  return { id };
});

async function auditConfirm(ctx: CompanyContext, id: string, number: string) {
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "salesInvoice.confirm",
    entityType: "SalesInvoice",
    entityId: id,
    after: { number },
  });
}

/** Salvestab ja kinnitab ühe tehinguna (kinnitamise õigus). */
export const confirmSalesInvoice = companyAction({ module: "sales", level: "confirm", schema: invoiceSchema }, async (input, ctx) => {
  const result = await tx(async (t) => {
    const id = await saveInvoiceDraft(t, ctx.company.id, ctx.user.id, draftInput(input));
    return confirmInvoice(t, ctx.company.id, ctx.user.id, id);
  });
  await auditConfirm(ctx, result.id, result.number);
  revalidatePath(invoicesPath(ctx.company.id));
  return result;
});

const idOnly = z.object({ id: idSchema });
const idAndDate = z.object({ id: idSchema, date: dateSchema });

export const confirmSalesInvoiceById = companyAction({ module: "sales", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const result = await tx((t) => confirmInvoice(t, ctx.company.id, ctx.user.id, id));
  await auditConfirm(ctx, result.id, result.number);
  revalidatePath(invoicesPath(ctx.company.id));
  return result;
});

export const deleteSalesInvoice = companyAction({ module: "sales", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  await tx((t) => deleteInvoiceDraft(t, ctx.company.id, id));
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "salesInvoice.deleteDraft", entityType: "SalesInvoice", entityId: id });
  revalidatePath(invoicesPath(ctx.company.id));
});

export const creditSalesInvoice = companyAction({ module: "sales", level: "edit", schema: idAndDate }, async ({ id, date }, ctx) => {
  const creditId = await tx((t) => createCreditDraft(t, ctx.company.id, ctx.user.id, id, date));
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "salesInvoice.credit", entityType: "SalesInvoice", entityId: creditId, after: { creditOf: id } });
  revalidatePath(invoicesPath(ctx.company.id));
  return { id: creditId };
});

export const taxFreeSalesInvoice = companyAction({ module: "sales", level: "edit", schema: idAndDate }, async ({ id, date }, ctx) => {
  const creditId = await tx((t) => createTaxFreeDraft(t, ctx.company.id, ctx.user.id, id, date));
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "salesInvoice.taxFree", entityType: "SalesInvoice", entityId: creditId, after: { creditOf: id } });
  revalidatePath(invoicesPath(ctx.company.id));
  return { id: creditId };
});

export const copySalesInvoice = companyAction({ module: "sales", level: "edit", schema: idAndDate }, async ({ id, date }, ctx) => {
  const copyId = await tx((t) => copyInvoice(t, ctx.company.id, ctx.user.id, id, date));
  revalidatePath(invoicesPath(ctx.company.id));
  return { id: copyId };
});

// --- E-post -------------------------------------------------------------------

const emailListSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v, ctx) => {
    const list = (v ?? "")
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    for (const e of list) {
      if (!emailSchema.safeParse(e).success) {
        ctx.addIssue({ code: "custom", message: "email" });
        return z.NEVER;
      }
    }
    return list.slice(0, 5);
  });

const sendSchema = z.object({
  id: idSchema,
  to: emailSchema,
  cc: emailListSchema,
  subject: requiredText(200),
  body: requiredText(5000),
});

async function sendDocument(
  ctx: CompanyContext,
  kind: "SalesInvoice" | "Quote",
  input: z.output<typeof sendSchema>,
  pdf: { buffer: Buffer; filename: string },
) {
  const res = await deliverDocument({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    documentType: kind,
    documentId: input.id,
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    body: input.body,
    attachment: { filename: pdf.filename, content: pdf.buffer },
    replyTo: ctx.user.email,
  });
  if (!res.ok) throw new ActionError(res.error);
}

export const sendSalesInvoice = companyAction({ module: "sales", level: "edit", schema: sendSchema }, async (input, ctx) => {
  const invoice = await ctx.cdb.salesInvoice.findFirst({ where: { id: input.id }, select: { status: true } });
  if (!invoice) throw new ActionError("notFound");
  if (invoice.status !== "CONFIRMED") throw new ActionError("sales.notConfirmed");
  const pdf = await invoicePdf(ctx.company.id, input.id);
  if (!pdf) throw new ActionError("notFound");
  await sendDocument(ctx, "SalesInvoice", input, pdf);
  await ctx.cdb.salesInvoice.update({ where: { id: input.id }, data: { sentAt: new Date() } });
  revalidatePath(invoicesPath(ctx.company.id));
});

// --- Pakkumised ---------------------------------------------------------------

const quoteSchema = z.object({
  id: idSchema.optional(),
  customerId: idSchema,
  date: dateSchema,
  validUntil: optionalDateSchema,
  currency: currencySchema,
  pricesIncludeVat: z.boolean(),
  yourReference: optionalText(100),
  notes: optionalText(2000),
  lines: z.array(lineSchema).max(500),
});

export const saveQuoteAction = companyAction({ module: "sales", level: "edit", schema: quoteSchema }, async (input, ctx) => {
  const id = await tx((t) =>
    saveQuote(t, ctx.company.id, ctx.user.id, {
      id: input.id,
      customerId: input.customerId,
      date: input.date,
      validUntil: input.validUntil,
      currency: input.currency,
      pricesIncludeVat: input.pricesIncludeVat,
      yourReference: input.yourReference,
      notes: input.notes,
      lines: toLines(input.lines),
    }),
  );
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "quote.update" : "quote.create",
    entityType: "Quote",
    entityId: id,
    after: { date: toISODate(input.date), lines: input.lines.length },
  });
  revalidatePath(quotesPath(ctx.company.id));
  return { id };
});

export const setQuoteStatus = companyAction(
  { module: "sales", level: "edit", schema: z.object({ id: idSchema, status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED"]) }) },
  async ({ id, status }, ctx) => {
    const res = await ctx.cdb.quote.updateMany({ where: { id, status: { not: "INVOICED" } }, data: { status } });
    if (res.count !== 1) throw new ActionError("sales.quoteInvoiced");
    revalidatePath(quotesPath(ctx.company.id));
  },
);

export const deleteQuote = companyAction({ module: "sales", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  const quote = await ctx.cdb.quote.findFirst({ where: { id }, select: { status: true, number: true } });
  if (!quote) throw new ActionError("notFound");
  if (quote.status === "INVOICED") throw new ActionError("sales.quoteInvoiced");
  await ctx.cdb.quote.delete({ where: { id } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "quote.delete", entityType: "Quote", entityId: id, before: { number: quote.number } });
  revalidatePath(quotesPath(ctx.company.id));
});

export const quoteToInvoiceAction = companyAction({ module: "sales", level: "edit", schema: idAndDate }, async ({ id, date }, ctx) => {
  const invoiceId = await tx((t) => quoteToInvoice(t, ctx.company.id, ctx.user.id, id, date));
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "quote.toInvoice", entityType: "Quote", entityId: id, after: { invoiceId } });
  revalidatePath(quotesPath(ctx.company.id));
  revalidatePath(invoicesPath(ctx.company.id));
  return { id: invoiceId };
});

export const sendQuote = companyAction({ module: "sales", level: "edit", schema: sendSchema }, async (input, ctx) => {
  const pdf = await quotePdf(ctx.company.id, input.id);
  if (!pdf) throw new ActionError("notFound");
  await sendDocument(ctx, "Quote", input, pdf);
  await ctx.cdb.quote.updateMany({
    where: { id: input.id },
    data: { sentAt: new Date(), ...(pdf.quote.status === "DRAFT" ? { status: "SENT" as const } : {}) },
  });
  revalidatePath(quotesPath(ctx.company.id));
});
