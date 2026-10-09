"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { dateSchema, idSchema } from "@/lib/validation";
import { createInterestInvoices } from "@/server/services/interest";
import { consolidateQuotes } from "@/server/services/consolidated";
import { statementCandidates, statementEmail, statementPdf } from "@/server/sales/statements";
import { deliverDocument, splitEmails } from "@/server/sales/mailer";

/** Viivisearved valitud klientidele. */
export const createInterestInvoicesAction = companyAction(
  {
    module: "sales",
    level: "edit",
    schema: z.object({ asOf: dateSchema, date: dateSchema, customerIds: z.array(idSchema).min(1).max(500), confirm: z.boolean() }),
  },
  async (input, ctx) => {
    if (input.confirm && !can(ctx.membership, "sales", "confirm")) throw new ActionError("forbidden");
    const ids = await db.$transaction((tx) => createInterestInvoices(tx, ctx.company.id, ctx.user.id, input), { timeout: 60_000 });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "interest.create",
      entityType: "SalesInvoice",
      entityId: ids[0]!,
      after: { invoices: ids.length, customers: input.customerIds.length, confirm: input.confirm },
    });
    revalidatePath(`/c/${ctx.company.id}/sales`, "layout");
    return { count: ids.length, ids };
  },
);

/**
 * Meeldetuletuste või saldoteatiste masssaatmine. Igale kliendile oma PDF ja kiri tema keeles;
 * tulemus kliendi kaupa (e-posti puudumine ei katkesta teiste saatmist).
 */
export const sendStatementsAction = companyAction(
  {
    module: "sales",
    level: "edit",
    schema: z.object({
      kind: z.enum(["REMINDER", "STATEMENT"]),
      asOf: dateSchema,
      minOverdueDays: z.number().int().min(0).max(3650),
      customerIds: z.array(idSchema).min(1).max(200),
    }),
  },
  async (input, ctx) => {
    const candidates = await statementCandidates(ctx.company.id, input.kind, input.asOf, input.minOverdueDays);
    const chosen = candidates.filter((c) => input.customerIds.includes(c.customerId));
    let sent = 0;
    let noEmail = 0;
    let failed = 0;
    for (const c of chosen) {
      if (!c.email) {
        noEmail++;
        continue;
      }
      const pdf = await statementPdf(ctx.company.id, input.kind, c, input.asOf);
      const mail = await statementEmail(ctx.company.id, input.kind, c, input.asOf);
      const res = await deliverDocument({
        companyId: ctx.company.id,
        userId: ctx.user.id,
        documentType: input.kind === "REMINDER" ? "Reminder" : "Statement",
        documentId: c.customerId,
        to: c.email,
        cc: splitEmails(c.emailCc),
        subject: mail.subject,
        body: mail.body,
        attachment: { filename: pdf.filename, content: pdf.buffer },
        replyTo: ctx.user.email,
      });
      if (res.ok) sent++;
      else if (res.error === "emailNotConfigured" || res.error === "rateLimited") throw new ActionError(res.error);
      else failed++;
    }
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: input.kind === "REMINDER" ? "reminders.send" : "statements.send",
      entityType: "Company",
      entityId: ctx.company.id,
      after: { sent, noEmail, failed },
    });
    revalidatePath(`/c/${ctx.company.id}/sales/reminders`);
    return { sent, noEmail, failed };
  },
);

/** Koondarve mitmest pakkumisest. */
export const consolidateQuotesAction = companyAction(
  { module: "sales", level: "edit", schema: z.object({ quoteIds: z.array(idSchema).min(1).max(100), date: dateSchema }) },
  async (input, ctx) => {
    const id = await db.$transaction((tx) => consolidateQuotes(tx, ctx.company.id, ctx.user.id, input.quoteIds, input.date), { timeout: 30_000 });
    await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "salesInvoice.consolidate", entityType: "SalesInvoice", entityId: id, after: { quotes: input.quoteIds.length } });
    revalidatePath(`/c/${ctx.company.id}/sales`, "layout");
    return { id };
  },
);
