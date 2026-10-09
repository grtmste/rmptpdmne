"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { toISODate } from "@/lib/accounting/dates";
import { codeSchema, dateSchema, decimalInputSchema, idSchema, optionalIdSchema, optionalText, requiredText } from "@/lib/validation";
import { bookQuantities, confirmMovement, deleteMovementDraft, recalculateItems, saveMovementDraft } from "@/server/services/inventory";
import type { CompanyContext } from "@/server/session";

const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(fn, { timeout: 60_000 });
const base = (companyId: string) => `/c/${companyId}/inventory`;

async function log(ctx: CompanyContext, action: string, entityType: string, entityId: string, after?: Record<string, unknown>) {
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action, entityType, entityId, after });
}

// --- Laod --------------------------------------------------------------------------

const warehouseSchema = z.object({
  id: idSchema.optional(),
  code: codeSchema(20),
  name: requiredText(120),
  address: optionalText(250),
  isDefault: z.boolean(),
  active: z.boolean(),
});

export const saveWarehouse = companyAction({ module: "inventory", level: "edit", schema: warehouseSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  if (data.isDefault) data.active = true;
  const saved = await tx(async (t) => {
    if (id && !(await t.warehouse.findFirst({ where: { companyId: ctx.company.id, id } }))) throw new ActionError("notFound");
    if (data.isDefault) await t.warehouse.updateMany({ where: { companyId: ctx.company.id, isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    return id
      ? t.warehouse.update({ where: { id }, data })
      : t.warehouse.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  });
  await log(ctx, id ? "warehouse.update" : "warehouse.create", "Warehouse", saved.id, { code: data.code, name: data.name });
  revalidatePath(base(ctx.company.id), "layout");
  return { id: saved.id };
});

export const deleteWarehouse = companyAction({ module: "inventory", level: "edit", schema: z.object({ id: idSchema }) }, async ({ id }, ctx) => {
  const w = await ctx.cdb.warehouse.findFirst({ where: { id } });
  if (!w) throw new ActionError("notFound");
  const used =
    (await ctx.cdb.stockMovement.count({ where: { OR: [{ warehouseId: id }, { toWarehouseId: id }] } })) +
    (await ctx.cdb.salesInvoice.count({ where: { warehouseId: id } })) +
    (await ctx.cdb.purchaseInvoice.count({ where: { warehouseId: id } }));
  // Kasutatud ladu jääb ajaloo jaoks alles passiivsena
  if (used > 0) {
    await ctx.cdb.warehouse.update({ where: { id }, data: { active: false, isDefault: false } });
    revalidatePath(base(ctx.company.id), "layout");
    return { deactivated: true };
  }
  await ctx.cdb.warehouse.delete({ where: { id } });
  await log(ctx, "warehouse.delete", "Warehouse", id, { code: w.code });
  revalidatePath(base(ctx.company.id), "layout");
  return { deactivated: false };
});

// --- Omahinna meetod ja ümberarvestus --------------------------------------------

export const setCostMethod = companyAction(
  { module: "inventory", level: "confirm", schema: z.object({ method: z.enum(["FIFO", "AVERAGE"]) }) },
  async ({ method }, ctx) => {
    const changed = await tx(async (t) => {
      await t.company.update({ where: { id: ctx.company.id }, data: { costMethod: method } });
      return recalculateItems(t, ctx.company.id, ctx.user.id);
    });
    await log(ctx, "inventory.costMethod", "Company", ctx.company.id, { method, changed });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
    return { changed };
  },
);

export const recalculateStock = companyAction({ module: "inventory", level: "confirm", schema: z.object({}) }, async (_input, ctx) => {
  const changed = await tx((t) => recalculateItems(t, ctx.company.id, ctx.user.id));
  await log(ctx, "inventory.recalculate", "Company", ctx.company.id, { changed });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return { changed };
});

// --- Liikumised ------------------------------------------------------------------

const movementSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(["RECEIPT", "ISSUE", "TRANSFER", "COUNT"]),
  date: dateSchema,
  warehouseId: idSchema,
  toWarehouseId: optionalIdSchema,
  counterAccountId: optionalIdSchema,
  description: optionalText(500),
  lines: z
    .array(
      z.object({
        itemId: idSchema,
        quantity: decimalInputSchema(4),
        unitCost: decimalInputSchema(4, { empty: "" }).transform((v) => (v === "" ? null : v)),
      }),
    )
    .max(1000),
});

export const saveMovementAction = companyAction({ module: "inventory", level: "edit", schema: movementSchema }, async (input, ctx) => {
  const id = await tx((t) => saveMovementDraft(t, ctx.company.id, ctx.user.id, input));
  await log(ctx, input.id ? "stockMovement.updateDraft" : "stockMovement.createDraft", "StockMovement", id, { type: input.type, date: toISODate(input.date) });
  revalidatePath(`${base(ctx.company.id)}/movements`);
  return { id };
});

export const confirmMovementAction = companyAction({ module: "inventory", level: "confirm", schema: movementSchema }, async (input, ctx) => {
  const result = await tx(async (t) => {
    const id = await saveMovementDraft(t, ctx.company.id, ctx.user.id, input);
    return confirmMovement(t, ctx.company.id, ctx.user.id, id);
  });
  await log(ctx, "stockMovement.confirm", "StockMovement", result.id, { number: result.number });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return result;
});

const idOnly = z.object({ id: idSchema });

export const confirmMovementById = companyAction({ module: "inventory", level: "confirm", schema: idOnly }, async ({ id }, ctx) => {
  const result = await tx((t) => confirmMovement(t, ctx.company.id, ctx.user.id, id));
  await log(ctx, "stockMovement.confirm", "StockMovement", id, { number: result.number });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return result;
});

export const deleteMovementAction = companyAction({ module: "inventory", level: "edit", schema: idOnly }, async ({ id }, ctx) => {
  await tx((t) => deleteMovementDraft(t, ctx.company.id, id));
  await log(ctx, "stockMovement.deleteDraft", "StockMovement", id);
  revalidatePath(`${base(ctx.company.id)}/movements`);
});

/** Inventuuri vormi jaoks: lao arvestuslikud kogused kuupäeva seisuga. */
export const loadBookQuantities = companyAction(
  { module: "inventory", level: "view", schema: z.object({ warehouseId: idSchema, date: dateSchema }) },
  async ({ warehouseId, date }, ctx) => {
    const q = await bookQuantities(db, ctx.company.id, { until: date, warehouseId });
    return Object.fromEntries([...q].map(([k, v]) => [k.split("|")[0]!, v.toString()]));
  },
);
