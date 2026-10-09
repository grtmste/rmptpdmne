"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { InventoryError } from "@/server/services/inventory";
import { audit, diffRecords } from "@/lib/audit";
import { codeSchema, decimalInputSchema, idSchema, optionalIdSchema, optionalText, requiredText } from "@/lib/validation";

const path = (companyId: string) => `/c/${companyId}/items`;

const optionalPrice = decimalInputSchema(4, { empty: "" }).transform((v) => (v === "" ? null : v));

const itemSchema = z.object({
  id: idSchema.optional(),
  code: codeSchema(30),
  name: requiredText(200),
  nameEn: optionalText(200),
  type: z.enum(["GOODS", "SERVICE"]),
  unit: optionalText(20),
  salePrice: optionalPrice,
  purchasePrice: optionalPrice,
  vatRateId: optionalIdSchema,
  salesAccountId: optionalIdSchema,
  purchaseAccountId: optionalIdSchema,
  groupId: optionalIdSchema,
  forSales: z.boolean(),
  forPurchases: z.boolean(),
  trackStock: z.boolean(),
  inventoryAccountId: optionalIdSchema,
  cogsAccountId: optionalIdSchema,
  description: optionalText(1000),
  active: z.boolean(),
});

export const saveItem = companyAction({ module: "sales", level: "edit", schema: itemSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  // Valikulised viited peavad kuuluma samale ettevõttele
  if (data.vatRateId && !(await ctx.cdb.vatRate.findFirst({ where: { id: data.vatRateId } }))) throw new ActionError("notFound");
  if (data.type !== "GOODS") data.trackStock = false;
  if (!data.trackStock) Object.assign(data, { inventoryAccountId: null, cogsAccountId: null });
  for (const accountId of [data.salesAccountId, data.purchaseAccountId, data.inventoryAccountId, data.cogsAccountId]) {
    if (accountId && !(await ctx.cdb.glAccount.findFirst({ where: { id: accountId, kind: "DETAIL" } }))) throw new ActionError("notFound");
  }
  if (data.groupId && !(await ctx.cdb.itemGroup.findFirst({ where: { id: data.groupId } }))) throw new ActionError("notFound");
  if (id) {
    const before = await ctx.cdb.item.findFirst({ where: { id } });
    if (!before) throw new ActionError("notFound");
    // Laoliikumistega artiklit ei saa laokaubast tavaartikliks muuta (laoseis ja omahind kaoks)
    if (before.trackStock && !data.trackStock && (await ctx.cdb.stockMovementLine.count({ where: { itemId: id } })) > 0) {
      throw new InventoryError("stockItemHasMovements");
    }
    const after = await ctx.cdb.item.update({ where: { id }, data });
    const diff = diffRecords(before, after);
    if (diff) await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "item.update", entityType: "Item", entityId: id, ...diff });
    revalidatePath(path(ctx.company.id));
    return { id };
  }
  const created = await ctx.cdb.item.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "item.create", entityType: "Item", entityId: created.id, after: { code: data.code, name: data.name } });
  revalidatePath(path(ctx.company.id));
  return { id: created.id };
});

export const deleteItem = companyAction(
  { module: "sales", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const item = await ctx.cdb.item.findFirst({ where: { id } });
    if (!item) throw new ActionError("notFound");
    const used =
      (await ctx.cdb.salesInvoiceLine.count({ where: { itemId: id } })) +
      (await ctx.cdb.quoteLine.count({ where: { itemId: id } })) +
      (await ctx.cdb.stockMovementLine.count({ where: { itemId: id } }));
    // Kasutatud artiklit ei kustutata (ajalugu jääb loetavaks) – see muudetakse passiivseks
    if (used > 0) {
      await ctx.cdb.item.update({ where: { id }, data: { active: false } });
      revalidatePath(path(ctx.company.id));
      return { deactivated: true };
    }
    await ctx.cdb.item.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "item.delete", entityType: "Item", entityId: id, before: { code: item.code, name: item.name } });
    revalidatePath(path(ctx.company.id));
    return { deactivated: false };
  },
);

const groupSchema = z.object({ id: idSchema.optional(), name: requiredText(80) });

export const saveItemGroup = companyAction({ module: "sales", level: "edit", schema: groupSchema }, async ({ id, name }, ctx) => {
  if (id) {
    if (!(await ctx.cdb.itemGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.itemGroup.update({ where: { id }, data: { name } });
  } else {
    await ctx.cdb.itemGroup.create({ data: { name, companyId: ctx.company.id, createdById: ctx.user.id } });
  }
  revalidatePath(path(ctx.company.id));
});

export const deleteItemGroup = companyAction(
  { module: "sales", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    if (!(await ctx.cdb.itemGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.itemGroup.delete({ where: { id } });
    revalidatePath(path(ctx.company.id));
  },
);
