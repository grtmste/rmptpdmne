"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { companyAction, userAction, ActionError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { regCodeSchema, requiredText, vatNumberSchema } from "@/lib/validation";
import { adminOrganizationFor, createCompanyForUser } from "@/server/services/accounts";

const companySchema = z.object({
  name: requiredText(200),
  regCode: regCodeSchema,
  vatNumber: vatNumberSchema,
});

export const createCompany = userAction(companySchema, async (input, user) => {
  const organizationId = await adminOrganizationFor(db, user.id);
  if (!organizationId) throw new ActionError("forbidden");
  const company = await createCompanyForUser(db, user.id, organizationId, input);
  return { companyId: company.id };
});

export const updateCompany = companyAction({ module: "settings", level: "edit", schema: companySchema }, async (input, ctx) => {
  const before = await ctx.cdb.company.findFirstOrThrow({
    select: { name: true, regCode: true, vatNumber: true },
  });
  const after = await ctx.cdb.company.update({
    where: { id: ctx.company.id },
    data: input,
    select: { name: true, regCode: true, vatNumber: true },
  });
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
