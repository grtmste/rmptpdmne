"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { validateFiscalYear } from "@/lib/accounting/fiscal";
import { toISODate } from "@/lib/accounting/dates";
import { dateSchema, idSchema, optionalDateSchema } from "@/lib/validation";

const yearSchema = z.object({ id: idSchema.optional(), startDate: dateSchema, endDate: dateSchema });

export const saveFiscalYear = companyAction({ module: "settings", level: "confirm", schema: yearSchema }, async (input, ctx) => {
  const others = await ctx.cdb.fiscalYear.findMany();
  const issue = validateFiscalYear({ id: input.id, startDate: input.startDate, endDate: input.endDate }, others);
  if (issue) throw new ActionError(`fiscal.${issue}`);

  if (input.id) {
    const before = others.find((y) => y.id === input.id);
    if (!before) throw new ActionError("notFound");
    if (before.closedAt) throw new ActionError("fiscal.closed");
    // Kanded ei tohi jääda aastast välja
    const outside = await ctx.cdb.journalEntry.count({
      where: {
        date: { gte: before.startDate, lte: before.endDate },
        OR: [{ date: { lt: input.startDate } }, { date: { gt: input.endDate } }],
        source: { not: "OPENING_BALANCE" },
      },
    });
    if (outside > 0) throw new ActionError("fiscal.entriesOutside");
    await ctx.cdb.fiscalYear.update({ where: { id: input.id }, data: { startDate: input.startDate, endDate: input.endDate } });
  } else {
    await ctx.cdb.fiscalYear.create({
      data: { companyId: ctx.company.id, startDate: input.startDate, endDate: input.endDate, createdById: ctx.user.id },
    });
  }
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: input.id ? "fiscalYear.update" : "fiscalYear.create",
    entityType: "FiscalYear",
    entityId: input.id ?? null,
    after: { startDate: toISODate(input.startDate), endDate: toISODate(input.endDate) },
  });
  revalidatePath(`/c/${ctx.company.id}/settings/fiscal-years`);
});

export const deleteFiscalYear = companyAction(
  { module: "settings", level: "confirm", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const year = await ctx.cdb.fiscalYear.findFirst({ where: { id } });
    if (!year) throw new ActionError("notFound");
    const entries = await ctx.cdb.journalEntry.count({
      where: { date: { gte: year.startDate, lte: year.endDate }, source: { not: "OPENING_BALANCE" } },
    });
    if (entries > 0) throw new ActionError("fiscal.hasEntries");
    await ctx.cdb.fiscalYear.delete({ where: { id } });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "fiscalYear.delete",
      entityType: "FiscalYear",
      entityId: id,
      before: { startDate: toISODate(year.startDate), endDate: toISODate(year.endDate) },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/fiscal-years`);
  },
);

/**
 * Majandusaasta sulgemine/avamine. Sulgemiskanded (tulude-kulude ülekanne jaotamata kasumisse)
 * lisanduvad koos aruannetega faasis 6; siin lukustatakse aasta muudatuste eest.
 */
export const setFiscalYearClosed = companyAction(
  { module: "settings", level: "confirm", schema: z.object({ id: idSchema, closed: z.boolean() }) },
  async ({ id, closed }, ctx) => {
    const year = await ctx.cdb.fiscalYear.findFirst({ where: { id } });
    if (!year) throw new ActionError("notFound");
    if (closed) {
      // Varasemad aastad peavad olema enne suletud
      const openEarlier = await ctx.cdb.fiscalYear.count({ where: { endDate: { lt: year.startDate }, closedAt: null } });
      if (openEarlier > 0) throw new ActionError("fiscal.closeEarlierFirst");
    } else {
      const closedLater = await ctx.cdb.fiscalYear.count({ where: { startDate: { gt: year.endDate }, closedAt: { not: null } } });
      if (closedLater > 0) throw new ActionError("fiscal.reopenLaterFirst");
    }
    await ctx.cdb.fiscalYear.update({ where: { id }, data: { closedAt: closed ? new Date() : null } });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: closed ? "fiscalYear.close" : "fiscalYear.reopen",
      entityType: "FiscalYear",
      entityId: id,
      after: { startDate: toISODate(year.startDate), endDate: toISODate(year.endDate) },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/fiscal-years`);
  },
);

/** Perioodi lukustamine: kuni selle kuupäevani (k.a) kandeid lisada ega muuta ei saa. */
export const setLockDate = companyAction(
  { module: "settings", level: "confirm", schema: z.object({ lockedUntil: optionalDateSchema }) },
  async ({ lockedUntil }, ctx) => {
    const before = await ctx.cdb.company.findFirstOrThrow({ select: { lockedUntil: true } });
    await ctx.cdb.company.update({ where: { id: ctx.company.id }, data: { lockedUntil } });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "period.lock",
      entityType: "Company",
      entityId: ctx.company.id,
      before: { lockedUntil: before.lockedUntil ? toISODate(before.lockedUntil) : null },
      after: { lockedUntil: lockedUntil ? toISODate(lockedUntil) : null },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/fiscal-years`);
  },
);
