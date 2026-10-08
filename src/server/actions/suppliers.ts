"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { audit, diffRecords } from "@/lib/audit";
import { isValidIban, normalizeIban } from "@/lib/iban";
import {
  emailSchema,
  idSchema,
  optionalIdSchema,
  optionalText,
  regCodeSchema,
  requiredText,
  vatNumberSchema,
} from "@/lib/validation";

const path = (companyId: string) => `/c/${companyId}/purchases/suppliers`;

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(emailSchema.nullable());

const ibanSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? normalizeIban(v) : null))
  .refine((v) => v === null || isValidIban(v), { error: "iban" });

const daysSchema = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      ctx.addIssue({ code: "custom", message: "days" });
      return z.NEVER;
    }
    return n;
  });

const supplierSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(200),
  isPerson: z.boolean(),
  regCode: regCodeSchema,
  vatNumber: vatNumberSchema,
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, { error: "country" }),
  addressStreet: optionalText(200),
  addressCity: optionalText(100),
  addressPostalCode: optionalText(20),
  addressCounty: optionalText(100),
  email: optionalEmail,
  phone: optionalText(50),
  contactPerson: optionalText(100),
  bankAccount: ibanSchema,
  referenceNumber: optionalText(20),
  paymentTermDays: daysSchema,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: "currency" }),
  groupId: optionalIdSchema,
  defaultAccountId: optionalIdSchema,
  defaultVatRateId: optionalIdSchema,
  notes: optionalText(2000),
  active: z.boolean(),
});

export const saveSupplier = companyAction({ module: "purchases", level: "edit", schema: supplierSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  if (data.groupId && !(await ctx.cdb.supplierGroup.findFirst({ where: { id: data.groupId } }))) throw new ActionError("notFound");
  if (data.defaultAccountId && !(await ctx.cdb.glAccount.findFirst({ where: { id: data.defaultAccountId, kind: "DETAIL" } }))) {
    throw new ActionError("notFound");
  }
  if (data.defaultVatRateId && !(await ctx.cdb.vatRate.findFirst({ where: { id: data.defaultVatRateId } }))) throw new ActionError("notFound");
  if (id) {
    const before = await ctx.cdb.supplier.findFirst({ where: { id } });
    if (!before) throw new ActionError("notFound");
    const after = await ctx.cdb.supplier.update({ where: { id }, data });
    const diff = diffRecords(before, after);
    if (diff) await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "supplier.update", entityType: "Supplier", entityId: id, ...diff });
    revalidatePath(path(ctx.company.id));
    return { id, name: after.name };
  }
  const created = await ctx.cdb.supplier.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "supplier.create", entityType: "Supplier", entityId: created.id, after: { name: data.name } });
  revalidatePath(path(ctx.company.id));
  return { id: created.id, name: created.name };
});

export const deleteSupplier = companyAction(
  { module: "purchases", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const supplier = await ctx.cdb.supplier.findFirst({ where: { id } });
    if (!supplier) throw new ActionError("notFound");
    const used = (await ctx.cdb.purchaseInvoice.count({ where: { supplierId: id } })) + (await ctx.cdb.purchaseOrder.count({ where: { supplierId: id } }));
    if (used > 0) throw new ActionError("inUse");
    await ctx.cdb.supplier.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "supplier.delete", entityType: "Supplier", entityId: id, before: { name: supplier.name } });
    revalidatePath(path(ctx.company.id));
  },
);

const groupSchema = z.object({ id: idSchema.optional(), name: requiredText(80) });

export const saveSupplierGroup = companyAction({ module: "purchases", level: "edit", schema: groupSchema }, async ({ id, name }, ctx) => {
  if (id) {
    if (!(await ctx.cdb.supplierGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.supplierGroup.update({ where: { id }, data: { name } });
  } else {
    await ctx.cdb.supplierGroup.create({ data: { name, companyId: ctx.company.id, createdById: ctx.user.id } });
  }
  revalidatePath(path(ctx.company.id));
});

export const deleteSupplierGroup = companyAction(
  { module: "purchases", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    if (!(await ctx.cdb.supplierGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.supplierGroup.delete({ where: { id } });
    revalidatePath(path(ctx.company.id));
  },
);

// --- Aruandvad isikud -----------------------------------------------------------

const employeeSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(120),
  personalCode: optionalText(20),
  email: optionalEmail,
  bankAccount: ibanSchema,
  active: z.boolean(),
});

export const saveEmployee = companyAction({ module: "purchases", level: "edit", schema: employeeSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  if (id) {
    if (!(await ctx.cdb.employee.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.employee.update({ where: { id }, data });
  } else {
    await ctx.cdb.employee.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  }
  revalidatePath(`/c/${ctx.company.id}/purchases/employees`);
});

export const deleteEmployee = companyAction(
  { module: "purchases", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    if (!(await ctx.cdb.employee.findFirst({ where: { id } }))) throw new ActionError("notFound");
    if ((await ctx.cdb.expenseReport.count({ where: { employeeId: id } })) > 0) throw new ActionError("inUse");
    await ctx.cdb.employee.delete({ where: { id } });
    revalidatePath(`/c/${ctx.company.id}/purchases/employees`);
  },
);
