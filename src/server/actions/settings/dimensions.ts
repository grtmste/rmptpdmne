"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { codeSchema, idSchema, optionalDateSchema, requiredText } from "@/lib/validation";

const path = (companyId: string) => `/c/${companyId}/settings/dimensions`;

// --- Osakonnad --------------------------------------------------------------

const departmentSchema = z.object({
  id: idSchema.optional(),
  code: codeSchema(16),
  name: requiredText(64),
  active: z.boolean(),
});

export const saveDepartment = companyAction({ module: "settings", level: "edit", schema: departmentSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  if (id) {
    const before = await ctx.cdb.department.findFirst({ where: { id } });
    if (!before) throw new ActionError("notFound");
    const after = await ctx.cdb.department.update({ where: { id }, data });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "department.update", entityType: "Department", entityId: id, before, after });
  } else {
    const created = await ctx.cdb.department.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "department.create", entityType: "Department", entityId: created.id, after: data });
  }
  revalidatePath(path(ctx.company.id));
});

export const deleteDepartment = companyAction(
  { module: "settings", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const dep = await ctx.cdb.department.findFirst({ where: { id } });
    if (!dep) throw new ActionError("notFound");
    if ((await ctx.cdb.journalLine.count({ where: { departmentId: id } })) > 0) throw new ActionError("inUse");
    await ctx.cdb.department.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "department.delete", entityType: "Department", entityId: id, before: { code: dep.code, name: dep.name } });
    revalidatePath(path(ctx.company.id));
  },
);

// --- Dimensioonid -----------------------------------------------------------

const dimensionSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(50),
  kind: z.enum(["DETAIL", "SUMMARY"]),
  parentId: idSchema.optional().or(z.literal("")),
  debitPositive: z.boolean(),
  active: z.boolean(),
});

export const saveDimension = companyAction({ module: "settings", level: "edit", schema: dimensionSchema }, async (input, ctx) => {
  const parentId = input.parentId || null;
  if (parentId) {
    const parent = await ctx.cdb.dimension.findFirst({ where: { id: parentId } });
    if (!parent || parent.kind !== "SUMMARY" || parent.id === input.id) throw new ActionError("dimensions.invalidParent");
  }
  if (input.kind === "SUMMARY" && parentId) throw new ActionError("dimensions.invalidParent");
  const data = { name: input.name, kind: input.kind, parentId, debitPositive: input.debitPositive, active: input.active };
  if (input.id) {
    const before = await ctx.cdb.dimension.findFirst({ where: { id: input.id }, include: { _count: { select: { values: true } } } });
    if (!before) throw new ActionError("notFound");
    if (before.kind !== input.kind && before._count.values > 0) throw new ActionError("dimensions.hasValues");
    await ctx.cdb.dimension.update({ where: { id: input.id }, data });
  } else {
    const count = await ctx.cdb.dimension.count();
    await ctx.cdb.dimension.create({ data: { ...data, companyId: ctx.company.id, sortOrder: count, createdById: ctx.user.id } });
  }
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "dimension.update" : "dimension.create",
    entityType: "Dimension",
    entityId: input.id ?? null,
    after: data,
  });
  revalidatePath(path(ctx.company.id));
});

export const deleteDimension = companyAction(
  { module: "settings", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const dim = await ctx.cdb.dimension.findFirst({ where: { id } });
    if (!dim) throw new ActionError("notFound");
    const used = await ctx.cdb.journalLineDimension.count({ where: { value: { dimensionId: id } } });
    if (used > 0) throw new ActionError("inUse");
    const required = await ctx.cdb.glAccount.count({ where: { requiredDimensionIds: { has: id } } });
    if (required > 0) throw new ActionError("dimensions.requiredOnAccounts");
    await ctx.cdb.dimension.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "dimension.delete", entityType: "Dimension", entityId: id, before: { name: dim.name } });
    revalidatePath(path(ctx.company.id));
  },
);

const valueSchema = z.object({
  id: idSchema.optional(),
  dimensionId: idSchema,
  code: codeSchema(20),
  name: requiredText(100),
  endDate: optionalDateSchema,
  active: z.boolean(),
});

export const saveDimensionValue = companyAction({ module: "settings", level: "edit", schema: valueSchema }, async (input, ctx) => {
  const dim = await ctx.cdb.dimension.findFirst({ where: { id: input.dimensionId } });
  if (!dim) throw new ActionError("notFound");
  if (dim.kind !== "DETAIL") throw new ActionError("dimensions.summaryHasNoValues");
  const data = { code: input.code, name: input.name, endDate: input.endDate, active: input.active };
  if (input.id) {
    const before = await ctx.cdb.dimensionValue.findFirst({ where: { id: input.id, dimensionId: dim.id } });
    if (!before) throw new ActionError("notFound");
    await ctx.cdb.dimensionValue.update({ where: { id: input.id }, data });
  } else {
    await ctx.cdb.dimensionValue.create({
      data: { ...data, companyId: ctx.company.id, dimensionId: dim.id, createdById: ctx.user.id },
    });
  }
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "dimensionValue.update" : "dimensionValue.create",
    entityType: "DimensionValue",
    entityId: input.id ?? null,
    after: { dimension: dim.name, code: input.code, name: input.name },
  });
  revalidatePath(path(ctx.company.id));
});

export const deleteDimensionValue = companyAction(
  { module: "settings", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const value = await ctx.cdb.dimensionValue.findFirst({ where: { id } });
    if (!value) throw new ActionError("notFound");
    if ((await ctx.cdb.journalLineDimension.count({ where: { dimensionValueId: id } })) > 0) throw new ActionError("inUse");
    await ctx.cdb.dimensionValue.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "dimensionValue.delete", entityType: "DimensionValue", entityId: id, before: { code: value.code, name: value.name } });
    revalidatePath(path(ctx.company.id));
  },
);
