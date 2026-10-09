"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { dateSchema, idSchema, optionalDateSchema, optionalText, requiredText } from "@/lib/validation";
import { runRecurring, saveRecurring } from "@/server/services/recurring";
import { sendInvoiceAutomatically } from "@/server/sales/auto-send";
import { currencySchema, lineSchema } from "./sales-schemas";

const recurringSchema = z.object({
  id: idSchema.optional(),
  name: requiredText(120),
  customerId: idSchema,
  active: z.boolean(),
  mode: z.enum(["DRAFT", "CONFIRM", "SEND"]),
  intervalMonths: z.number().int().refine((v) => [1, 2, 3, 6, 12].includes(v), { error: "invalid" }),
  startDate: dateSchema,
  endDate: optionalDateSchema,
  paymentTermDays: z
    .string()
    .trim()
    .regex(/^\d{0,3}$/, { error: "invalid" })
    .transform((v) => (v === "" ? null : Number(v))),
  currency: currencySchema,
  pricesIncludeVat: z.boolean(),
  yourReference: optionalText(100),
  notes: optionalText(2000),
  lines: z.array(lineSchema).min(1, { error: "required" }).max(200),
});

const path = (companyId: string) => `/c/${companyId}/sales/recurring`;

export const saveRecurringAction = companyAction({ module: "sales", level: "edit", schema: recurringSchema }, async (input, ctx) => {
  const id = await db.$transaction(
    (tx) =>
      saveRecurring(tx, ctx.company.id, ctx.user.id, {
        ...input,
        lines: input.lines.map((l) => ({ ...l, dimensionValueIds: l.dimensionValueIds ?? [] })),
      }),
    { timeout: 20_000 },
  );
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "recurring.update" : "recurring.create",
    entityType: "RecurringInvoice",
    entityId: id,
    after: { name: input.name, mode: input.mode, intervalMonths: input.intervalMonths, lines: input.lines.length },
  });
  revalidatePath(path(ctx.company.id));
  return { id };
});

/** Koostab järgmise arve kohe (ei oota ajastatud tööd). */
export const runRecurringNow = companyAction({ module: "sales", level: "edit", schema: z.object({ id: idSchema }) }, async (input, ctx) => {
  const r = await ctx.cdb.recurringInvoice.findFirst({ where: { id: input.id }, select: { mode: true } });
  if (!r) throw new ActionError("notFound");
  // Kinnitamine nõuab kinnitusõigust
  if (r.mode !== "DRAFT" && !can(ctx.membership, "sales", "confirm")) throw new ActionError("forbidden");
  const res = await db.$transaction((tx) => runRecurring(tx, ctx.company.id, ctx.user.id, input.id), { timeout: 30_000 });
  let sent: string | null = null;
  if (res.send) {
    const d = await sendInvoiceAutomatically(ctx.company.id, res.invoiceId, ctx.user.id);
    sent = d.ok ? "sent" : d.error;
  }
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "recurring.run", entityType: "RecurringInvoice", entityId: input.id, after: { invoiceId: res.invoiceId, sent } });
  revalidatePath(path(ctx.company.id));
  return { invoiceId: res.invoiceId, sent };
});

export const deleteRecurring = companyAction({ module: "sales", level: "edit", schema: z.object({ id: idSchema }) }, async (input, ctx) => {
  const r = await ctx.cdb.recurringInvoice.findFirst({ where: { id: input.id }, select: { id: true, name: true } });
  if (!r) throw new ActionError("notFound");
  // Tehtud arved jäävad alles, seos kustub (onDelete: SetNull)
  await db.recurringInvoice.delete({ where: { id: r.id } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "recurring.delete", entityType: "RecurringInvoice", entityId: r.id, before: { name: r.name } });
  revalidatePath(path(ctx.company.id));
  return null;
});
