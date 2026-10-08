"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { audit, diffRecords } from "@/lib/audit";
import { LOCALES } from "@/i18n/config";
import type { CompanyContext } from "@/server/session";
import {
  decimalInputSchema,
  emailSchema,
  idSchema,
  optionalIdSchema,
  optionalText,
  regCodeSchema,
  requiredText,
  vatNumberSchema,
} from "@/lib/validation";

const path = (companyId: string) => `/c/${companyId}/sales/customers`;

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(emailSchema.nullable());

const customerSchema = z.object({
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
  emailCc: optionalText(500),
  phone: optionalText(50),
  contactPerson: optionalText(100),
  paymentTermDays: z
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
    }),
  lateInterestPct: decimalInputSchema(3, { empty: "" }).transform((v) => (v === "" ? null : v)),
  locale: z.enum(LOCALES),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: "currency" }),
  referenceNumber: optionalText(20),
  groupId: optionalIdSchema,
  defaultVatRateId: optionalIdSchema,
  notes: optionalText(2000),
  active: z.boolean(),
});

async function assertRefs(
  ctx: CompanyContext,
  refs: { groupId: string | null; defaultVatRateId: string | null },
) {
  if (refs.groupId && !(await ctx.cdb.customerGroup.findFirst({ where: { id: refs.groupId } }))) throw new ActionError("notFound");
  if (refs.defaultVatRateId && !(await ctx.cdb.vatRate.findFirst({ where: { id: refs.defaultVatRateId } }))) {
    throw new ActionError("notFound");
  }
}

export const saveCustomer = companyAction({ module: "sales", level: "edit", schema: customerSchema }, async (input, ctx) => {
  const { id, ...data } = input;
  await assertRefs(ctx, data);
  if (data.referenceNumber && !/^\d{2,20}$/.test(data.referenceNumber)) throw new ActionError("validation");
  if (id) {
    const before = await ctx.cdb.customer.findFirst({ where: { id } });
    if (!before) throw new ActionError("notFound");
    const after = await ctx.cdb.customer.update({ where: { id }, data });
    const diff = diffRecords(before, after);
    if (diff) {
      await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "customer.update", entityType: "Customer", entityId: id, ...diff });
    }
    revalidatePath(path(ctx.company.id));
    return { id };
  }
  const created = await ctx.cdb.customer.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "customer.create", entityType: "Customer", entityId: created.id, after: { name: data.name } });
  revalidatePath(path(ctx.company.id));
  return { id: created.id, name: created.name };
});

export const deleteCustomer = companyAction(
  { module: "sales", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const customer = await ctx.cdb.customer.findFirst({ where: { id } });
    if (!customer) throw new ActionError("notFound");
    const used = (await ctx.cdb.salesInvoice.count({ where: { customerId: id } })) + (await ctx.cdb.quote.count({ where: { customerId: id } }));
    if (used > 0) throw new ActionError("inUse");
    await ctx.cdb.customer.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "customer.delete", entityType: "Customer", entityId: id, before: { name: customer.name } });
    revalidatePath(path(ctx.company.id));
  },
);

// --- Kliendigrupid ----------------------------------------------------------

const groupSchema = z.object({ id: idSchema.optional(), name: requiredText(80) });

export const saveCustomerGroup = companyAction({ module: "sales", level: "edit", schema: groupSchema }, async ({ id, name }, ctx) => {
  if (id) {
    if (!(await ctx.cdb.customerGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.customerGroup.update({ where: { id }, data: { name } });
  } else {
    await ctx.cdb.customerGroup.create({ data: { name, companyId: ctx.company.id, createdById: ctx.user.id } });
  }
  revalidatePath(path(ctx.company.id));
});

export const deleteCustomerGroup = companyAction(
  { module: "sales", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    if (!(await ctx.cdb.customerGroup.findFirst({ where: { id } }))) throw new ActionError("notFound");
    await ctx.cdb.customerGroup.delete({ where: { id } });
    revalidatePath(path(ctx.company.id));
  },
);
