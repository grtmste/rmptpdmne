"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { companyAction, userAction, ActionError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { optionalDateSchema, optionalText, regCodeSchema, requiredText, vatNumberSchema } from "@/lib/validation";
import { adminOrganizationFor, createCompanyForUser } from "@/server/services/accounts";

const createSchema = z.object({
  name: requiredText(200),
  regCode: regCodeSchema,
  vatNumber: vatNumberSchema,
  accountingStartDate: optionalDateSchema,
});

export const createCompany = userAction(createSchema, async (input, user) => {
  const organizationId = await adminOrganizationFor(db, user.id);
  if (!organizationId) throw new ActionError("forbidden");
  const company = await createCompanyForUser(db, user.id, organizationId, {
    ...input,
    accountingStartDate: input.accountingStartDate ?? undefined,
  });
  return { companyId: company.id };
});

const updateSchema = z.object({
  name: requiredText(200),
  regCode: regCodeSchema,
  vatNumber: vatNumberSchema,
  addressStreet: optionalText(200),
  addressCity: optionalText(100),
  addressCounty: optionalText(100),
  addressPostalCode: optionalText(20),
  phone: optionalText(50),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, { error: "email" }),
  website: optionalText(200),
  documentLocale: z.enum(["et", "en", "fi", "ru"]),
});

const FIELDS = {
  name: true,
  regCode: true,
  vatNumber: true,
  addressStreet: true,
  addressCity: true,
  addressCounty: true,
  addressPostalCode: true,
  phone: true,
  email: true,
  website: true,
  documentLocale: true,
} as const;

export const updateCompany = companyAction({ module: "settings", level: "edit", schema: updateSchema }, async (input, ctx) => {
  const before = await ctx.cdb.company.findFirstOrThrow({ select: FIELDS });
  const after = await ctx.cdb.company.update({ where: { id: ctx.company.id }, data: input, select: FIELDS });
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "company.update",
    entityType: "Company",
    entityId: ctx.company.id,
    before,
    after,
  });
  revalidatePath(`/c/${ctx.company.id}`, "layout");
});
