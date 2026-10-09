"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { closeVatPeriod, reopenVatPeriod } from "@/server/services/vat";

const periodSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

/** KMD sulgemiskanne valitud kuule. */
export const closeVatAction = companyAction({ module: "finance", level: "edit", schema: periodSchema }, async (input, ctx) => {
  const entryId = await db.$transaction((tx) => closeVatPeriod(tx, ctx.company.id, ctx.user.id, input.year, input.month), { timeout: 20_000 });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "vat.close", entityType: "JournalEntry", entityId: entryId, after: input });
  revalidatePath(`/c/${ctx.company.id}/finance`, "layout");
  return { id: entryId };
});

/** Tühistab kuu sulgemiskande (ainult avatud perioodis). */
export const reopenVatAction = companyAction({ module: "finance", level: "edit", schema: periodSchema }, async (input, ctx) => {
  await db.$transaction((tx) => reopenVatPeriod(tx, ctx.company.id, input.year, input.month), { timeout: 20_000 });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "vat.reopen", entityType: "Company", entityId: ctx.company.id, after: input });
  revalidatePath(`/c/${ctx.company.id}/finance`, "layout");
  return null;
});
