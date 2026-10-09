import type { Prisma } from "@/generated/prisma/client";
import { dec, type DecimalInput } from "@/lib/money";
import { dueDateFrom } from "@/lib/sales/calc";
import { fillPlaceholders, nextOccurrence } from "@/lib/sales/recurring";
import { confirmInvoice, saveInvoiceDraft, SalesError, type SalesLineInput } from "./sales";

/**
 * Perioodilised arved: mall (klient, read, kordus) ja arvete koostamine ajakava järgi.
 * Koostamine on idempotentne kuupäeva kohta: `runCount` ja `nextDate` muudetakse samas tehingus
 * arve loomisega, nii et sama kuupäeva arvet ei teki kaks korda.
 */

type Tx = Prisma.TransactionClient;

export type RecurringLineInput = {
  itemId?: string | null;
  code?: string | null;
  description: string;
  quantity: DecimalInput;
  unit?: string | null;
  unitPrice: DecimalInput;
  discountPct?: DecimalInput | null;
  vatRateId?: string | null;
  accountId?: string | null;
  departmentId?: string | null;
  dimensionValueIds?: string[];
};

export type RecurringInput = {
  id?: string;
  name: string;
  customerId: string;
  active: boolean;
  mode: "DRAFT" | "CONFIRM" | "SEND";
  intervalMonths: number;
  startDate: Date;
  endDate?: Date | null;
  paymentTermDays?: number | null;
  currency?: string | null;
  pricesIncludeVat: boolean;
  yourReference?: string | null;
  notes?: string | null;
  lines: RecurringLineInput[];
};

export async function saveRecurring(tx: Tx, companyId: string, userId: string | null, input: RecurringInput) {
  const customer = await tx.customer.findFirst({ where: { companyId, id: input.customerId }, select: { id: true, currency: true } });
  if (!customer) throw new SalesError("customerNotFound");
  if (input.lines.length === 0) throw new SalesError("noLines");
  if (input.endDate && input.endDate.getTime() < input.startDate.getTime()) throw new SalesError("invalidPeriod");

  const existing = input.id
    ? await tx.recurringInvoice.findFirst({ where: { companyId, id: input.id }, select: { id: true, runCount: true, startDate: true } })
    : null;
  if (input.id && !existing) throw new SalesError("invoiceNotFound");
  // Alguskuupäeva muutmine alustab ajakava otsast (juba tehtud arved jäävad)
  const restart = existing && existing.startDate.getTime() !== input.startDate.getTime();
  const runCount = existing && !restart ? existing.runCount : 0;
  const data = {
    name: input.name,
    customerId: customer.id,
    active: input.active,
    mode: input.mode,
    intervalMonths: input.intervalMonths,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    runCount,
    nextDate: nextOccurrence(input.startDate, input.intervalMonths, runCount, input.endDate ?? null),
    paymentTermDays: input.paymentTermDays ?? null,
    currency: input.currency || customer.currency,
    pricesIncludeVat: input.pricesIncludeVat,
    yourReference: input.yourReference ?? null,
    notes: input.notes ?? null,
    lastError: null,
  };
  const lines = input.lines.map((l, i) => ({
    companyId,
    itemId: l.itemId || null,
    code: l.code || null,
    description: l.description,
    quantity: dec(l.quantity).toString(),
    unit: l.unit || null,
    unitPrice: dec(l.unitPrice).toString(),
    discountPct: dec(l.discountPct || 0).toString(),
    vatRateId: l.vatRateId || null,
    accountId: l.accountId || null,
    departmentId: l.departmentId || null,
    dimensionValueIds: l.dimensionValueIds ?? [],
    sortOrder: i,
  }));
  if (existing) {
    await tx.recurringInvoice.update({ where: { id: existing.id }, data });
    await tx.recurringInvoiceLine.deleteMany({ where: { companyId, recurringId: existing.id } });
    await tx.recurringInvoiceLine.createMany({ data: lines.map((l) => ({ ...l, recurringId: existing.id })) });
    return existing.id;
  }
  const created = await tx.recurringInvoice.create({ data: { companyId, createdById: userId, ...data } });
  await tx.recurringInvoiceLine.createMany({ data: lines.map((l) => ({ ...l, recurringId: created.id })) });
  return created.id;
}

/**
 * Koostab perioodilise malli järgmise arve (kuupäev = ajakava kuupäev). Tagastab arve id ja
 * kas see tuleb saata (saatmine käib väljaspool tehingut, sest PDF ja e-kiri on aeglased).
 */
export async function runRecurring(tx: Tx, companyId: string, userId: string | null, id: string) {
  const r = await tx.recurringInvoice.findFirst({
    where: { companyId, id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!r) throw new SalesError("invoiceNotFound");
  if (!r.nextDate) throw new SalesError("recurringEnded");
  const date = r.nextDate;
  const customer = await tx.customer.findFirstOrThrow({ where: { companyId, id: r.customerId }, select: { locale: true } });
  const fill = (text: string | null) => (text ? fillPlaceholders(text, { date, intervalMonths: r.intervalMonths, locale: customer.locale }) : text);

  const lines: SalesLineInput[] = r.lines.map((l) => ({
    itemId: l.itemId,
    code: l.code,
    description: fill(l.description)!,
    quantity: l.quantity.toString(),
    unit: l.unit,
    unitPrice: l.unitPrice.toString(),
    discountPct: l.discountPct.toString(),
    vatRateId: l.vatRateId,
    accountId: l.accountId,
    departmentId: l.departmentId,
    dimensionValueIds: l.dimensionValueIds,
  }));
  const invoiceId = await saveInvoiceDraft(tx, companyId, userId, {
    type: "INVOICE",
    customerId: r.customerId,
    date,
    dueDate: r.paymentTermDays !== null ? dueDateFrom(date, r.paymentTermDays) : null,
    currency: r.currency,
    pricesIncludeVat: r.pricesIncludeVat,
    yourReference: fill(r.yourReference),
    notes: fill(r.notes) ?? undefined,
    recurringInvoiceId: r.id,
    lines,
  });
  if (r.mode !== "DRAFT") await confirmInvoice(tx, companyId, userId, invoiceId);

  const runCount = r.runCount + 1;
  const res = await tx.recurringInvoice.updateMany({
    where: { companyId, id: r.id, runCount: r.runCount },
    data: { runCount, nextDate: nextOccurrence(r.startDate, r.intervalMonths, runCount, r.endDate), lastRunAt: new Date(), lastError: null },
  });
  // Samaaegne käivitus jõudis ette – tühistame selle tehingu
  if (res.count !== 1) throw new SalesError("recurringBusy");
  return { invoiceId, send: r.mode === "SEND" };
}

/** Kõigi ettevõtete mallid, mille järgmine arve on tänaseks tähtaeg (cron). */
export function dueRecurring(tx: Tx, today: Date) {
  return tx.recurringInvoice.findMany({
    where: { active: true, nextDate: { lte: today } },
    select: { id: true, companyId: true, createdById: true, nextDate: true },
    orderBy: { nextDate: "asc" },
  });
}
