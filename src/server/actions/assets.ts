"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { codeSchema, dateSchema, decimalInputSchema, idSchema, optionalIdSchema, optionalText, requiredText } from "@/lib/validation";
import { monthStart } from "@/lib/assets/depreciation";
import { todayLocal } from "@/lib/dates";
import {
  AssetError,
  cancelDepreciationRun,
  deleteAsset,
  disposeAsset,
  reclassifyAsset,
  revalueAsset,
  runDepreciation,
  saveAsset,
} from "@/server/services/assets";
import type { CompanyContext } from "@/server/session";

const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(fn, { timeout: 60_000 });
const assetsPath = (companyId: string) => `/c/${companyId}/assets`;

async function log(ctx: CompanyContext, action: string, entityType: string, entityId: string, after?: Record<string, unknown>) {
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action, entityType, entityId, after });
}

const lifeSchema = z.coerce.number().int().min(1, { error: "lifeMonths" }).max(1200, { error: "lifeMonths" });

// --- Grupid ja asukohad -----------------------------------------------------------

const groupSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(80),
  assetAccountId: idSchema,
  accumulatedAccountId: idSchema,
  expenseAccountId: idSchema,
  usefulLifeMonths: z.union([z.literal(""), lifeSchema]).transform((v) => (v === "" ? null : v)),
});

export const saveAssetGroup = companyAction({ module: "assets", level: "edit", schema: groupSchema }, async ({ id, ...data }, ctx) => {
  for (const accountId of [data.assetAccountId, data.accumulatedAccountId, data.expenseAccountId]) {
    if (!(await ctx.cdb.glAccount.findFirst({ where: { id: accountId, kind: "DETAIL" } }))) throw new ActionError("notFound");
  }
  if (id) {
    if (!(await ctx.cdb.fixedAssetGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.fixedAssetGroup.update({ where: { id }, data });
  } else {
    await ctx.cdb.fixedAssetGroup.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  }
  await log(ctx, id ? "assetGroup.update" : "assetGroup.create", "FixedAssetGroup", id ?? "", { name: data.name });
  revalidatePath(assetsPath(ctx.company.id), "layout");
});

export const deleteAssetGroup = companyAction({ module: "assets", level: "edit", schema: z.object({ id: idSchema }) }, async ({ id }, ctx) => {
  if (!(await ctx.cdb.fixedAssetGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
  if ((await ctx.cdb.fixedAsset.count({ where: { groupId: id } })) > 0) throw new ActionError("inUse");
  await ctx.cdb.fixedAssetGroup.delete({ where: { id } });
  revalidatePath(assetsPath(ctx.company.id), "layout");
});

export const saveAssetLocation = companyAction(
  { module: "assets", level: "edit", schema: z.object({ id: idSchema.optional(), name: requiredText(80) }) },
  async ({ id, name }, ctx) => {
    if (id) {
      if (!(await ctx.cdb.fixedAssetLocation.findFirst({ where: { id } }))) throw new ActionError("notFound");
      await ctx.cdb.fixedAssetLocation.update({ where: { id }, data: { name } });
    } else {
      await ctx.cdb.fixedAssetLocation.create({ data: { name, companyId: ctx.company.id, createdById: ctx.user.id } });
    }
    revalidatePath(assetsPath(ctx.company.id), "layout");
  },
);

export const deleteAssetLocation = companyAction({ module: "assets", level: "edit", schema: z.object({ id: idSchema }) }, async ({ id }, ctx) => {
  if (!(await ctx.cdb.fixedAssetLocation.findFirst({ where: { id } }))) throw new ActionError("notFound");
  await ctx.cdb.fixedAssetLocation.delete({ where: { id } });
  revalidatePath(assetsPath(ctx.company.id), "layout");
});

// --- Varad ------------------------------------------------------------------------

const assetSchema = z.object({
  id: idSchema.optional(),
  code: codeSchema(30),
  name: requiredText(200),
  groupId: idSchema,
  locationId: optionalIdSchema,
  responsibleId: optionalIdSchema,
  serialNumber: optionalText(100),
  acquisitionDate: dateSchema,
  depreciationStart: dateSchema,
  cost: decimalInputSchema(2),
  residualValue: decimalInputSchema(2),
  usefulLifeMonths: lifeSchema,
  openingDepreciation: decimalInputSchema(2),
  openingMonths: z.coerce.number().int().min(0).max(1200),
  assetAccountId: optionalIdSchema,
  accumulatedAccountId: optionalIdSchema,
  expenseAccountId: optionalIdSchema,
  departmentId: optionalIdSchema,
  purchaseInvoiceId: optionalIdSchema,
  notes: optionalText(2000),
});

export const saveAssetAction = companyAction({ module: "assets", level: "edit", schema: assetSchema }, async (input, ctx) => {
  const id = await tx((t) => saveAsset(t, ctx.company.id, ctx.user.id, input));
  await log(ctx, input.id ? "fixedAsset.update" : "fixedAsset.create", "FixedAsset", id, { code: input.code, name: input.name, cost: input.cost });
  revalidatePath(assetsPath(ctx.company.id));
  return { id };
});

export const deleteAssetAction = companyAction({ module: "assets", level: "edit", schema: z.object({ id: idSchema }) }, async ({ id }, ctx) => {
  await tx((t) => deleteAsset(t, ctx.company.id, id));
  await log(ctx, "fixedAsset.delete", "FixedAsset", id);
  revalidatePath(assetsPath(ctx.company.id));
});

// --- Kulum ja muutused ------------------------------------------------------------------

const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .transform((v, c) => {
    const d = parseISODate(`${v}-01`);
    if (!d) {
      c.addIssue({ code: "custom", message: "date" });
      return z.NEVER;
    }
    return d;
  });

export const runDepreciationAction = companyAction({ module: "assets", level: "confirm", schema: z.object({ period: periodSchema }) }, async ({ period }, ctx) => {
  // Kulumit ei arvestata ette (tulevaste kuude eest)
  if (period > monthStart(todayLocal())) throw new AssetError("futurePeriod");
  const result = await tx((t) => runDepreciation(t, ctx.company.id, ctx.user.id, period));
  await log(ctx, "depreciation.run", "DepreciationRun", result.id, { period: toISODate(period).slice(0, 7), total: result.total.toFixed(2), assets: result.count });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
  return { id: result.id, total: result.total.toFixed(2), count: result.count };
});

export const cancelDepreciationAction = companyAction({ module: "assets", level: "confirm", schema: z.object({ id: idSchema }) }, async ({ id }, ctx) => {
  await tx((t) => cancelDepreciationRun(t, ctx.company.id, id));
  await log(ctx, "depreciation.cancel", "DepreciationRun", id);
  revalidatePath(`/c/${ctx.company.id}`, "layout");
});

export const revalueAssetAction = companyAction(
  {
    module: "assets",
    level: "confirm",
    schema: z.object({
      assetId: idSchema,
      date: dateSchema,
      newCost: decimalInputSchema(2),
      usefulLifeMonths: z.union([z.literal(""), lifeSchema]).transform((v) => (v === "" ? null : v)),
      counterAccountId: optionalIdSchema,
      description: optionalText(250),
    }),
  },
  async (input, ctx) => {
    await tx((t) => revalueAsset(t, ctx.company.id, ctx.user.id, input));
    await log(ctx, "fixedAsset.revalue", "FixedAsset", input.assetId, { date: toISODate(input.date), newCost: input.newCost, life: input.usefulLifeMonths });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
  },
);

export const disposeAssetAction = companyAction(
  { module: "assets", level: "confirm", schema: z.object({ assetId: idSchema, date: dateSchema, lossAccountId: idSchema, description: optionalText(250) }) },
  async (input, ctx) => {
    const r = await tx((t) => disposeAsset(t, ctx.company.id, ctx.user.id, input));
    await log(ctx, "fixedAsset.dispose", "FixedAsset", input.assetId, { date: toISODate(input.date), bookValue: r.bookValue.toFixed(2) });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
  },
);

export const reclassifyAssetAction = companyAction(
  { module: "assets", level: "confirm", schema: z.object({ assetId: idSchema, date: dateSchema, groupId: idSchema, description: optionalText(250) }) },
  async (input, ctx) => {
    await tx((t) => reclassifyAsset(t, ctx.company.id, ctx.user.id, input));
    await log(ctx, "fixedAsset.reclassify", "FixedAsset", input.assetId, { date: toISODate(input.date), groupId: input.groupId });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
  },
);
