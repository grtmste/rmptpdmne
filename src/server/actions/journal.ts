"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { toISODate } from "@/lib/accounting/dates";
import { dateSchema, idSchema, moneyInputSchema, optionalText, requiredText } from "@/lib/validation";
import {
  copyToDraft,
  deleteDraft,
  postDraft,
  reverseEntry,
  saveDraft,
  type JournalLineInput,
} from "@/server/services/journal";

const lineSchema = z.object({
  accountId: z.string().max(64),
  debit: moneyInputSchema,
  credit: moneyInputSchema,
  description: z.string().trim().max(250).optional(),
  departmentId: z.string().max(64).optional(),
  vatRateId: z.string().max(64).optional(),
  vatAmount: moneyInputSchema.optional(),
  dimensionValueIds: z.array(idSchema).max(20).optional(),
});

const draftSchema = z.object({
  id: idSchema.optional(),
  date: dateSchema,
  description: optionalText(250),
  lines: z.array(lineSchema).max(500),
});

function toLines(lines: z.output<typeof lineSchema>[]): JournalLineInput[] {
  return lines
    .filter((l) => l.accountId)
    .map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description || null,
      departmentId: l.departmentId || null,
      vatRateId: l.vatRateId || null,
      vatAmount: l.vatRateId && l.vatAmount && l.vatAmount !== "0.00" ? l.vatAmount : null,
      dimensionValueIds: (l.dimensionValueIds ?? []).filter(Boolean),
    }));
}

const path = (companyId: string) => `/c/${companyId}/finance/journal`;

/** Salvestab kande mustandina (koostaja õigus piisab). */
export const saveJournalDraft = companyAction({ module: "finance", level: "edit", schema: draftSchema }, async (input, ctx) => {
  const id = await db.$transaction(
    (tx) =>
      saveDraft(tx, ctx.company.id, ctx.user.id, {
        id: input.id,
        date: input.date,
        description: input.description,
        lines: toLines(input.lines),
      }),
    { timeout: 20_000 },
  );
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "journal.updateDraft" : "journal.createDraft",
    entityType: "JournalEntry",
    entityId: id,
    after: { date: toISODate(input.date), description: input.description, lines: input.lines.length },
  });
  revalidatePath(path(ctx.company.id));
  return { id };
});

/** Salvestab ja postitab ühe tehinguna (kinnitamise õigus). */
export const postJournal = companyAction({ module: "finance", level: "confirm", schema: draftSchema }, async (input, ctx) => {
  const result = await db.$transaction(
    async (tx) => {
      const id = await saveDraft(tx, ctx.company.id, ctx.user.id, {
        id: input.id,
        date: input.date,
        description: input.description,
        lines: toLines(input.lines),
      });
      return postDraft(tx, ctx.company.id, ctx.user.id, id);
    },
    { timeout: 20_000 },
  );
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "journal.post",
    entityType: "JournalEntry",
    entityId: result.id,
    after: { number: result.number, date: toISODate(input.date), description: input.description },
  });
  revalidatePath(path(ctx.company.id));
  return result;
});

export const deleteJournalDraft = companyAction(
  { module: "finance", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    await db.$transaction((tx) => deleteDraft(tx, ctx.company.id, id));
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "journal.deleteDraft", entityType: "JournalEntry", entityId: id });
    revalidatePath(path(ctx.company.id));
  },
);

export const reverseJournal = companyAction(
  { module: "finance", level: "confirm", schema: z.object({ id: idSchema, date: dateSchema }) },
  async ({ id, date }, ctx) => {
    const entry = await db.$transaction((tx) => reverseEntry(tx, ctx.company.id, ctx.user.id, id, { date }), {
      timeout: 20_000,
    });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "journal.reverse",
      entityType: "JournalEntry",
      entityId: entry.id,
      after: { reversalOf: id, number: entry.number, date: toISODate(date) },
    });
    revalidatePath(path(ctx.company.id));
    return { id: entry.id, number: entry.number };
  },
);

export const copyJournal = companyAction(
  { module: "finance", level: "edit", schema: z.object({ id: idSchema, date: dateSchema }) },
  async ({ id, date }, ctx) => {
    const newId = await db.$transaction((tx) => copyToDraft(tx, ctx.company.id, ctx.user.id, id, date));
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "journal.copy",
      entityType: "JournalEntry",
      entityId: newId,
      after: { copyOf: id },
    });
    revalidatePath(path(ctx.company.id));
    return { id: newId };
  },
);

// --- Kandemallid --------------------------------------------------------------

const templateSchema = z.object({
  name: requiredText(100),
  description: optionalText(250),
  lines: z
    .array(
      z.object({
        accountId: idSchema,
        debit: moneyInputSchema,
        credit: moneyInputSchema,
        description: z.string().trim().max(250).optional(),
      }),
    )
    .min(1, { error: "required" })
    .max(100),
});

export const saveJournalTemplate = companyAction({ module: "finance", level: "edit", schema: templateSchema }, async (input, ctx) => {
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const found = await ctx.cdb.glAccount.count({ where: { id: { in: accountIds } } });
  if (found !== accountIds.length) throw new ActionError("notFound");
  const template = await ctx.cdb.$transaction(async (tx) => {
    const existing = await tx.journalTemplate.findFirst({ where: { name: input.name } });
    if (existing) await tx.journalTemplate.delete({ where: { id: existing.id } });
    const created = await tx.journalTemplate.create({
      data: { companyId: ctx.company.id, name: input.name, description: input.description, createdById: ctx.user.id },
    });
    await tx.journalTemplateLine.createMany({
      data: input.lines.map((l, sortOrder) => ({
        companyId: ctx.company.id,
        templateId: created.id,
        accountId: l.accountId,
        debit: l.debit === "0.00" ? null : l.debit,
        credit: l.credit === "0.00" ? null : l.credit,
        description: l.description || null,
        sortOrder,
      })),
    });
    return created;
  });
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "journalTemplate.save",
    entityType: "JournalTemplate",
    entityId: template.id,
    after: { name: input.name, lines: input.lines.length },
  });
  revalidatePath(path(ctx.company.id), "layout");
  return { id: template.id };
});

export const deleteJournalTemplate = companyAction(
  { module: "finance", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const t = await ctx.cdb.journalTemplate.findFirst({ where: { id } });
    if (!t) throw new ActionError("notFound");
    await ctx.cdb.journalTemplate.delete({ where: { id } });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "journalTemplate.delete", entityType: "JournalTemplate", entityId: id, before: { name: t.name } });
    revalidatePath(path(ctx.company.id), "layout");
  },
);

/** Postitab olemasoleva mustandi (eelvaatest). */
export const postJournalDraft = companyAction(
  { module: "finance", level: "confirm", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const result = await db.$transaction((tx) => postDraft(tx, ctx.company.id, ctx.user.id, id), { timeout: 20_000 });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "journal.post",
      entityType: "JournalEntry",
      entityId: id,
      after: { number: result.number },
    });
    revalidatePath(path(ctx.company.id));
    return result;
  },
);
