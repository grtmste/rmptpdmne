"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";

const seriesSchema = z.object({
  id: idSchema,
  prefix: z.string().trim().max(10, { error: "tooLong" }),
  suffix: z.string().trim().max(10, { error: "tooLong" }),
  yearBased: z.boolean(),
  padding: z.number().int().min(0).max(10),
  nextNumber: z.number().int().min(1, { error: "positive" }).max(999_999_999),
});

export const saveNumberSeries = companyAction({ module: "settings", level: "edit", schema: seriesSchema }, async (input, ctx) => {
  const before = await ctx.cdb.numberSeries.findFirst({ where: { id: input.id } });
  if (!before) throw new ActionError("notFound");
  const { id, ...data } = input;
  const after = await ctx.cdb.numberSeries.update({ where: { id }, data });
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "numberSeries.update",
    entityType: "NumberSeries",
    entityId: id,
    before,
    after,
  });
  revalidatePath(`/c/${ctx.company.id}/settings/number-series`);
});
