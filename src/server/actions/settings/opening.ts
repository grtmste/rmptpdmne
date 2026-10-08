"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { companyAction } from "@/lib/action";
import { dec } from "@/lib/money";
import { audit } from "@/lib/audit";
import { addDays, toISODate } from "@/lib/accounting/dates";
import { dateSchema, idSchema, moneyInputSchema } from "@/lib/validation";
import { assertPeriodOpen, postJournalEntry, type JournalLineInput } from "@/server/services/journal";

const openingSchema = z.object({
  /** Arvestuse alguse kuupäev; algsaldod on sellele eelneva päeva seisuga */
  accountingStartDate: dateSchema,
  lines: z
    .array(z.object({ accountId: idSchema, debit: moneyInputSchema, credit: moneyInputSchema }))
    .max(2000),
});

/**
 * Salvestab pearaamatu kontode algsaldod ühe kandena (allikas OPENING_BALANCE). Olemasolev
 * algsaldo kanne asendatakse. Kanne peab olema tasakaalus.
 */
export const saveOpeningBalances = companyAction(
  { module: "settings", level: "confirm", schema: openingSchema },
  async (input, ctx) => {
    // Kui real on mõlemad pooled, jääb alles vahe; nullread jäetakse välja.
    const lines = input.lines.flatMap((l): JournalLineInput[] => {
      const diff = dec(l.debit).minus(dec(l.credit));
      if (diff.isZero()) return [];
      return diff.isPositive()
        ? [{ accountId: l.accountId, debit: diff.toFixed(2) }]
        : [{ accountId: l.accountId, credit: diff.negated().toFixed(2) }];
    });
    const date = addDays(input.accountingStartDate, -1);

    const result = await db.$transaction(
      async (tx) => {
        const existing = await tx.journalEntry.findFirst({
          where: { companyId: ctx.company.id, source: "OPENING_BALANCE" },
        });
        if (existing) {
          await assertPeriodOpen(tx, ctx.company.id, existing.date, "OPENING_BALANCE");
          await tx.journalEntry.delete({ where: { id: existing.id } });
        }
        await tx.company.update({
          where: { id: ctx.company.id },
          data: { accountingStartDate: input.accountingStartDate },
        });
        if (lines.length === 0) return { entryId: null };
        const entry = await postJournalEntry(tx, ctx.company.id, ctx.user.id, {
          date,
          source: "OPENING_BALANCE",
          description: `Algsaldod ${toISODate(date)}`,
          lines,
        });
        return { entryId: entry.id };
      },
      { timeout: 30_000 },
    );
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "openingBalances.save",
      entityType: "JournalEntry",
      entityId: result.entryId,
      after: { date: toISODate(date), lines: lines.length },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/opening-balances`);
    return result;
  },
);
