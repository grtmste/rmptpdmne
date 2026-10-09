import "server-only";
import { db } from "@/lib/db";
import { toISODate } from "@/lib/accounting/dates";
import { annualReportDeadline, daysUntil, nextVatDeadline } from "@/lib/deadlines";
import { dueRecurring, runRecurring } from "@/server/services/recurring";
import { SalesError } from "@/server/services/sales";
import { sendInvoiceAutomatically } from "@/server/sales/auto-send";

/**
 * Igapäevane ajastatud töö (Vercel Cron): perioodilised arved ja tähtaegade teated.
 * Iga mall ja ettevõte töödeldakse eraldi, nii et üks viga ei peata teisi.
 */

/** Ühe käivitusega järele tehtavate arvete piir malli kohta (nt pärast pikemat seisakut). */
const MAX_CATCH_UP = 12;

export async function runRecurringJob(today: Date) {
  const due = await dueRecurring(db, today);
  const result = { templates: due.length, invoices: 0, sent: 0, sendFailed: 0, errors: 0 };
  for (const r of due) {
    for (let i = 0; i < MAX_CATCH_UP; i++) {
      const current = await db.recurringInvoice.findUnique({ where: { id: r.id }, select: { nextDate: true, active: true } });
      if (!current?.active || !current.nextDate || current.nextDate.getTime() > today.getTime()) break;
      try {
        const res = await db.$transaction((tx) => runRecurring(tx, r.companyId, r.createdById, r.id), { timeout: 30_000 });
        result.invoices++;
        if (res.send) {
          const sent = await sendInvoiceAutomatically(r.companyId, res.invoiceId, r.createdById);
          if (sent.ok) result.sent++;
          else {
            result.sendFailed++;
            await db.recurringInvoice.update({ where: { id: r.id }, data: { lastError: `send:${sent.error}` } });
          }
        }
      } catch (e) {
        result.errors++;
        const message = e instanceof SalesError ? `sales.${e.code}` : e instanceof Error ? e.message.slice(0, 300) : "unknown";
        await db.recurringInvoice.update({ where: { id: r.id }, data: { lastError: message } });
        break;
      }
    }
  }
  return result;
}

/** KMD (5 ja 1 päev enne) ja majandusaasta aruande (30 päeva enne) teated; iga teade üks kord. */
export async function runDeadlineNotifications(today: Date) {
  const companies = await db.company.findMany({
    where: { archivedAt: null },
    select: { id: true, fiscalYears: { where: { closedAt: null }, select: { endDate: true } } },
  });
  let created = 0;
  const vat = nextVatDeadline(today);
  const vatDays = daysUntil(today, vat.dueDate);
  for (const c of companies) {
    const notes: Array<{ title: string; body: string; href: string; dueDate: Date }> = [];
    if (vatDays === 5 || vatDays === 1) {
      notes.push({
        title: `KMD ${vat.period} tähtaeg ${toISODate(vat.dueDate).split("-").reverse().join(".")}`,
        body: vatDays === 1 ? "Käibedeklaratsiooni tähtaeg on homme." : "Käibedeklaratsiooni tähtajani on 5 päeva.",
        href: `/c/${c.id}/finance/vat?period=${vat.period}`,
        dueDate: vat.dueDate,
      });
    }
    for (const y of c.fiscalYears) {
      if (y.endDate.getTime() >= today.getTime()) continue;
      const due = annualReportDeadline(y.endDate);
      if (daysUntil(today, due) === 30) {
        notes.push({
          title: `Majandusaasta aruande tähtaeg ${toISODate(due).split("-").reverse().join(".")}`,
          body: "Aruande esitamiseni e-äriregistrisse on 30 päeva.",
          href: `/c/${c.id}/finance/balance-sheet`,
          dueDate: due,
        });
      }
    }
    for (const n of notes) {
      const exists = await db.notification.findFirst({ where: { companyId: c.id, kind: "deadline", dueDate: n.dueDate, title: n.title }, select: { id: true } });
      if (exists) continue;
      await db.notification.create({ data: { companyId: c.id, kind: "deadline", ...n } });
      created++;
    }
  }
  return { notifications: created };
}
