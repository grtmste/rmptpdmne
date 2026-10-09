"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { isValidIban, normalizeIban } from "@/lib/iban";
import { toISODate } from "@/lib/accounting/dates";
import { parseStatement, StatementParseError } from "@/lib/payments/statement";
import { dateSchema, decimalInputSchema, idSchema, optionalIdSchema, optionalText, requiredText } from "@/lib/validation";
import {
  cancelPayment,
  confirmPayment,
  deletePaymentDraft,
  openItems,
  PaymentError,
  savePayment,
} from "@/server/services/payments";
import {
  confirmStatementLine,
  createPaymentOrder,
  ignoreStatementLine,
  importStatement,
  markPaymentOrderPaid,
  matchStatement,
} from "@/server/services/bank";
import type { CompanyContext } from "@/server/session";

const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(fn, { timeout: 30_000 });
const paymentsPath = (companyId: string) => `/c/${companyId}/payments`;

async function log(ctx: CompanyContext, action: string, entityType: string, entityId: string, after?: Record<string, unknown>) {
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action, entityType, entityId, after });
}

// --- Pangad ja kassad ----------------------------------------------------------

const ibanSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? normalizeIban(v) : null))
  .refine((v) => v === null || isValidIban(v), { error: "iban" });

const bankAccountSchema = z.object({
  id: idSchema.optional(),
  kind: z.enum(["BANK", "CASH"]),
  name: requiredText(80),
  iban: ibanSchema,
  bic: optionalText(11),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: "currency" }),
  accountId: idSchema,
  showOnInvoice: z.boolean(),
  active: z.boolean(),
});

export const saveBankAccount = companyAction({ module: "payments", level: "confirm", schema: bankAccountSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  const account = await ctx.cdb.glAccount.findFirst({ where: { id: data.accountId, kind: "DETAIL", type: "ASSET" } });
  if (!account) throw new ActionError("notFound");
  if (id) {
    if (!(await ctx.cdb.bankAccount.findFirst({ where: { id } }))) throw new ActionError("notFound");
    // GL kontot ei muudeta, kui kontol on makseid (saldod jääksid valele kontole)
    const before = await ctx.cdb.bankAccount.findFirstOrThrow({ where: { id } });
    if (before.accountId !== data.accountId && (await ctx.cdb.payment.count({ where: { bankAccountId: id } })) > 0) throw new ActionError("inUse");
    await ctx.cdb.bankAccount.update({ where: { id }, data });
  } else {
    await ctx.cdb.bankAccount.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  }
  await log(ctx, id ? "bankAccount.update" : "bankAccount.create", "BankAccount", id ?? "", { name: data.name });
  revalidatePath(`${paymentsPath(ctx.company.id)}/accounts`);
});

export const deleteBankAccount = companyAction({ module: "payments", level: "confirm", schema: z.object({ id: idSchema }) }, async ({ id }, ctx) => {
  if (!(await ctx.cdb.bankAccount.findFirst({ where: { id } }))) throw new ActionError("notFound");
  if ((await ctx.cdb.payment.count({ where: { bankAccountId: id } })) + (await ctx.cdb.bankStatement.count({ where: { bankAccountId: id } })) > 0) {
    throw new ActionError("inUse");
  }
  await ctx.cdb.bankAccount.delete({ where: { id } });
  revalidatePath(`${paymentsPath(ctx.company.id)}/accounts`);
});

// --- Maksed ------------------------------------------------------------------------

const allocationSchema = z.object({
  type: z.enum(["SALES_INVOICE", "PURCHASE_INVOICE", "EXPENSE_REPORT", "PREPAYMENT", "ACCOUNT"]),
  salesInvoiceId: optionalIdSchema,
  purchaseInvoiceId: optionalIdSchema,
  expenseReportId: optionalIdSchema,
  accountId: optionalIdSchema,
  amount: decimalInputSchema(2, { negative: true }),
  description: optionalText(250),
});

const paymentSchema = z.object({
  id: idSchema.optional(),
  direction: z.enum(["IN", "OUT", "NETTING"]),
  bankAccountId: optionalIdSchema,
  date: dateSchema,
  amount: decimalInputSchema(2),
  currencyRate: decimalInputSchema(6, { empty: "" }).transform((v) => (v === "" || v === "0" ? null : v)),
  partyType: z.enum(["CUSTOMER", "SUPPLIER", "EMPLOYEE", "OTHER"]),
  customerId: optionalIdSchema,
  supplierId: optionalIdSchema,
  employeeId: optionalIdSchema,
  partyName: optionalText(200),
  partyIban: optionalText(34),
  referenceNumber: optionalText(25),
  description: optionalText(500),
  allocations: z.array(allocationSchema).max(300),
});

export const savePaymentAction = companyAction({ module: "payments", level: "edit", schema: paymentSchema }, async (input, ctx) => {
  const id = await tx((t) => savePayment(t, ctx.company.id, ctx.user.id, input));
  await log(ctx, input.id ? "payment.updateDraft" : "payment.createDraft", "Payment", id, { date: toISODate(input.date), amount: input.amount });
  revalidatePath(paymentsPath(ctx.company.id));
  return { id };
});

export const confirmPaymentAction = companyAction({ module: "payments", level: "confirm", schema: paymentSchema }, async (input, ctx) => {
  const result = await tx(async (t) => {
    const id = await savePayment(t, ctx.company.id, ctx.user.id, input);
    return confirmPayment(t, ctx.company.id, ctx.user.id, id);
  });
  await log(ctx, "payment.confirm", "Payment", result.id, { number: result.number });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return result;
});

const idOnly = z.object({ id: idSchema });

export const confirmPaymentById = companyAction({ module: "payments", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const result = await tx((t) => confirmPayment(t, ctx.company.id, ctx.user.id, id));
  await log(ctx, "payment.confirm", "Payment", id, { number: result.number });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return result;
});

export const deletePaymentAction = companyAction({ module: "payments", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  await tx((t) => deletePaymentDraft(t, ctx.company.id, id));
  await log(ctx, "payment.deleteDraft", "Payment", id);
  revalidatePath(paymentsPath(ctx.company.id));
});

export const cancelPaymentAction = companyAction(
  { module: "payments", level: "confirm", schema: z.object({ id: idSchema, date: dateSchema }) },
  async ({ id, date }, ctx) => {
    await tx((t) => cancelPayment(t, ctx.company.id, ctx.user.id, id, date));
    await log(ctx, "payment.cancel", "Payment", id, { date: toISODate(date) });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
  },
);

/** Makse vormi jaoks: osapoole (või kõigi) tasumata dokumendid. */
export const loadOpenItems = companyAction(
  {
    module: "payments",
    level: "view",
    schema: z.object({
      types: z.array(z.enum(["SALES_INVOICE", "PURCHASE_INVOICE", "EXPENSE_REPORT"])).min(1),
      customerId: optionalIdSchema,
      supplierId: optionalIdSchema,
      employeeId: optionalIdSchema,
    }),
  },
  async (input, ctx) => {
    const items = await openItems(db, ctx.company.id, {
      types: input.types,
      customerId: input.customerId ?? undefined,
      supplierId: input.supplierId ?? undefined,
      employeeId: input.employeeId ?? undefined,
      limit: 300,
    });
    return items.map((i) => ({ ...i, date: toISODate(i.date), dueDate: i.dueDate ? toISODate(i.dueDate) : null }));
  },
);

// --- Pangaväljavõtted -----------------------------------------------------------------

export const importStatementAction = companyAction(
  { module: "payments", level: "edit", schema: z.object({ bankAccountId: idSchema, file: z.instanceof(File) }) },
  async ({ bankAccountId, file }, ctx) => {
    if (file.size > 4 * 1024 * 1024) throw new ActionError("sales.attachmentTooLarge");
    let parsed;
    try {
      parsed = parseStatement(await file.text());
    } catch (e) {
      if (e instanceof StatementParseError) throw new PaymentError(e.code === "noEntries" ? "statementEmpty" : "statementInvalid");
      throw e;
    }
    const result = await tx((t) =>
      importStatement(t, ctx.company.id, ctx.user.id, { bankAccountId, fileName: file.name.slice(0, 200), format: parsed.format, statement: parsed.statement }),
    );
    await log(ctx, "bankStatement.import", "BankStatement", result.id, { imported: result.imported, skipped: result.skipped });
    revalidatePath(`${paymentsPath(ctx.company.id)}/statements`);
    return result;
  },
);

const resolutionSchema = z.union([
  z.object({ kind: z.literal("suggestion") }),
  z.object({
    kind: z.literal("manual"),
    partyType: z.enum(["CUSTOMER", "SUPPLIER", "EMPLOYEE", "OTHER"]),
    partyId: optionalIdSchema,
    description: optionalText(500),
    allocations: z.array(allocationSchema).min(1).max(100),
  }),
]);

export const confirmStatementLineAction = companyAction(
  { module: "payments", level: "confirm", schema: z.object({ lineId: idSchema, resolution: resolutionSchema }) },
  async ({ lineId, resolution }, ctx) => {
    const result = await tx((t) => confirmStatementLine(t, ctx.company.id, ctx.user.id, lineId, resolution));
    revalidatePath(`/c/${ctx.company.id}`, "layout");
    return result;
  },
);

/** Kinnitab väljavõtte kõik soovitused; vigased read jäävad alles ja nende arv tagastatakse. */
export const confirmAllSuggestions = companyAction(
  { module: "payments", level: "confirm", schema: z.object({ statementId: idSchema }) },
  async ({ statementId }, ctx) => {
    const lines = await ctx.cdb.bankStatementLine.findMany({ where: { statementId, status: "SUGGESTED" }, orderBy: { sortOrder: "asc" }, select: { id: true } });
    let confirmed = 0;
    let failed = 0;
    for (const l of lines) {
      try {
        await tx((t) => confirmStatementLine(t, ctx.company.id, ctx.user.id, l.id, { kind: "suggestion" }));
        confirmed++;
      } catch {
        failed++;
      }
    }
    await log(ctx, "bankStatement.confirmAll", "BankStatement", statementId, { confirmed, failed });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
    return { confirmed, failed };
  },
);

export const ignoreStatementLineAction = companyAction(
  { module: "payments", level: "edit", schema: z.object({ lineId: idSchema, ignore: z.boolean() }) },
  async ({ lineId, ignore }, ctx) => {
    await tx((t) => ignoreStatementLine(t, ctx.company.id, lineId, ignore));
    revalidatePath(`${paymentsPath(ctx.company.id)}/statements`);
  },
);

export const rematchStatement = companyAction({ module: "payments", level: "edit", schema: z.object({ statementId: idSchema }) }, async ({ statementId }, ctx) => {
  if (!(await ctx.cdb.bankStatement.findFirst({ where: { id: statementId } }))) throw new ActionError("notFound");
  const result = await tx((t) => matchStatement(t, ctx.company.id, statementId));
  revalidatePath(`${paymentsPath(ctx.company.id)}/statements`);
  return result;
});

export const deleteStatement = companyAction({ module: "payments", level: "edit", schema: z.object({ statementId: idSchema }) }, async ({ statementId }, ctx) => {
  if (!(await ctx.cdb.bankStatement.findFirst({ where: { id: statementId } }))) throw new ActionError("notFound");
  if ((await ctx.cdb.bankStatementLine.count({ where: { statementId, status: "DONE" } })) > 0) throw new ActionError("inUse");
  await ctx.cdb.bankStatement.delete({ where: { id: statementId } });
  await log(ctx, "bankStatement.delete", "BankStatement", statementId);
  revalidatePath(`${paymentsPath(ctx.company.id)}/statements`);
});

// --- Maksekorraldused ------------------------------------------------------------------

export const createPaymentOrderAction = companyAction(
  {
    module: "payments",
    level: "confirm",
    schema: z.object({
      bankAccountId: idSchema,
      executionDate: dateSchema,
      items: z
        .array(z.object({ type: z.enum(["PURCHASE_INVOICE", "EXPENSE_REPORT"]), id: idSchema, amount: decimalInputSchema(2) }))
        .min(1)
        .max(200),
    }),
  },
  async (input, ctx) => {
    const id = await tx((t) => createPaymentOrder(t, ctx.company.id, ctx.user.id, input));
    await log(ctx, "paymentOrder.create", "PaymentOrder", id, { items: input.items.length });
    revalidatePath(`${paymentsPath(ctx.company.id)}/orders`);
    return { id };
  },
);

export const markPaymentOrderPaidAction = companyAction({ module: "payments", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const ids = await tx((t) => markPaymentOrderPaid(t, ctx.company.id, ctx.user.id, id));
  await log(ctx, "paymentOrder.paid", "PaymentOrder", id, { payments: ids.length });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return { payments: ids.length };
});

export const deletePaymentOrder = companyAction({ module: "payments", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const order = await ctx.cdb.paymentOrder.findFirst({ where: { id }, select: { status: true } });
  if (!order) throw new ActionError("notFound");
  if (order.status === "PAID") throw new ActionError("inUse");
  await ctx.cdb.paymentOrder.delete({ where: { id } });
  revalidatePath(`${paymentsPath(ctx.company.id)}/orders`);
});
