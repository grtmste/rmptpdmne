import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec, roundMoney } from "@/lib/money";
import { addDays } from "@/lib/accounting/dates";
import { toBase } from "@/lib/sales/calc";
import { cashEffect } from "@/lib/payments/posting";
import { AGING_BUCKETS, agingBucket, type AgingBucket } from "@/lib/reports/aging";

/**
 * Klientide ja tarnijate võlgnevused kuupäeva seisuga ning partnerite käibeandmik.
 * Arve tasumata summa = kogusumma − kinnitatud (tühistamata) maksete sidumised kuni kuupäevani.
 * Ettemaksud (sidumine PREPAYMENT) vähendavad partneri saldot. Summad eurodes arve kursiga.
 */

type Tx = Prisma.TransactionClient;
export type DebtSide = "receivables" | "payables";

export type OpenDocument = {
  id: string;
  type: "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT";
  number: string;
  partyKey: string;
  partyName: string;
  date: Date;
  dueDate: Date;
  currency: string;
  total: Decimal;
  open: Decimal;
  /** Tasumata summa eurodes */
  openBase: Decimal;
  totalBase: Decimal;
};

const paidWhere = (asOf: Date): Prisma.PaymentWhereInput => ({ status: "CONFIRMED", date: { lte: asOf }, cancelledAt: null });

/** Kõik dokumendid kuni kuupäevani koos tasumata summaga (ka täielikult tasutud, open = 0). */
async function documents(tx: Tx, companyId: string, side: DebtSide, asOf: Date, from?: Date): Promise<OpenDocument[]> {
  const dateFilter = { lte: asOf, ...(from ? { gte: from } : {}) };
  const docs: OpenDocument[] = [];
  const paid = new Map<string, Decimal>();
  const addPaid = (id: string | null, v: Decimal) => id && paid.set(id, (paid.get(id) ?? dec(0)).plus(v));

  if (side === "receivables") {
    const invoices = await tx.salesInvoice.findMany({
      where: { companyId, status: "CONFIRMED", date: dateFilter },
      select: { id: true, number: true, customerId: true, customerName: true, date: true, dueDate: true, currency: true, currencyRate: true, total: true, totalBase: true },
    });
    const allocations = await tx.paymentAllocation.findMany({
      where: { companyId, salesInvoiceId: { in: invoices.map((i) => i.id) }, payment: paidWhere(asOf) },
      select: { salesInvoiceId: true, amount: true, type: true, payment: { select: { direction: true } } },
    });
    for (const a of allocations) addPaid(a.salesInvoiceId, cashEffect(a.payment.direction, a.type, a.amount));
    for (const i of invoices) {
      const open = dec(i.total).minus(paid.get(i.id) ?? 0);
      docs.push({
        id: i.id,
        type: "SALES_INVOICE",
        number: i.number ?? "",
        partyKey: `CUSTOMER:${i.customerId}`,
        partyName: i.customerName,
        date: i.date,
        dueDate: i.dueDate,
        currency: i.currency,
        total: dec(i.total),
        open,
        openBase: toBase(open, i.currencyRate),
        totalBase: dec(i.totalBase),
      });
    }
    return docs;
  }

  const invoices = await tx.purchaseInvoice.findMany({
    where: { companyId, status: "CONFIRMED", date: dateFilter },
    select: { id: true, number: true, invoiceNumber: true, supplierId: true, supplierName: true, date: true, dueDate: true, currency: true, currencyRate: true, total: true, totalBase: true },
  });
  const reports = await tx.expenseReport.findMany({
    where: { companyId, status: "CONFIRMED", date: dateFilter },
    select: { id: true, number: true, employeeId: true, employeeName: true, date: true, total: true },
  });
  const allocations = await tx.paymentAllocation.findMany({
    where: {
      companyId,
      OR: [{ purchaseInvoiceId: { in: invoices.map((i) => i.id) } }, { expenseReportId: { in: reports.map((r) => r.id) } }],
      payment: paidWhere(asOf),
    },
    select: { purchaseInvoiceId: true, expenseReportId: true, amount: true, type: true, payment: { select: { direction: true } } },
  });
  for (const a of allocations) addPaid(a.purchaseInvoiceId ?? a.expenseReportId, cashEffect(a.payment.direction, a.type, a.amount).negated());
  for (const i of invoices) {
    const open = dec(i.total).minus(paid.get(i.id) ?? 0);
    docs.push({
      id: i.id,
      type: "PURCHASE_INVOICE",
      number: i.invoiceNumber ? `${i.number ?? ""} (${i.invoiceNumber})` : (i.number ?? ""),
      partyKey: `SUPPLIER:${i.supplierId ?? i.supplierName}`,
      partyName: i.supplierName,
      date: i.date,
      dueDate: i.dueDate,
      currency: i.currency,
      total: dec(i.total),
      open,
      openBase: toBase(open, i.currencyRate),
      totalBase: dec(i.totalBase),
    });
  }
  for (const r of reports) {
    const open = dec(r.total).minus(paid.get(r.id) ?? 0);
    docs.push({
      id: r.id,
      type: "EXPENSE_REPORT",
      number: r.number ?? "",
      partyKey: `EMPLOYEE:${r.employeeId}`,
      partyName: r.employeeName,
      date: r.date,
      dueDate: r.date,
      currency: "EUR",
      total: dec(r.total),
      open,
      openBase: open,
      totalBase: dec(r.total),
    });
  }
  return docs;
}

/** Ettemaksude saldo partneri kaupa (positiivne = partner on ette maksnud / meie oleme ette maksnud). */
async function prepayments(tx: Tx, companyId: string, side: DebtSide, asOf: Date) {
  const rows = await tx.paymentAllocation.findMany({
    where: {
      companyId,
      type: "PREPAYMENT",
      payment: { ...paidWhere(asOf), partyType: side === "receivables" ? "CUSTOMER" : { in: ["SUPPLIER", "EMPLOYEE"] } },
    },
    select: {
      amount: true,
      payment: { select: { direction: true, partyType: true, customerId: true, supplierId: true, employeeId: true, partyName: true, currencyRate: true } },
    },
  });
  const out = new Map<string, { name: string; amount: Decimal }>();
  for (const r of rows) {
    const p = r.payment;
    const key = p.partyType === "CUSTOMER" ? `CUSTOMER:${p.customerId}` : p.partyType === "SUPPLIER" ? `SUPPLIER:${p.supplierId ?? p.partyName}` : `EMPLOYEE:${p.employeeId}`;
    const effect = cashEffect(p.direction, "PREPAYMENT", r.amount);
    const v = toBase(side === "receivables" ? effect : effect.negated(), p.currencyRate);
    const cur = out.get(key);
    out.set(key, { name: cur?.name ?? p.partyName, amount: (cur?.amount ?? dec(0)).plus(v) });
  }
  return out;
}

export type PartyAging = {
  partyKey: string;
  partyName: string;
  buckets: Record<AgingBucket, Decimal>;
  prepayment: Decimal;
  total: Decimal;
  documents: OpenDocument[];
};

/** Võlgnevused seisuga: tasumata dokumendid partneri ja tähtaja ületamise kaupa. */
export async function debtsAsOf(tx: Tx, companyId: string, side: DebtSide, asOf: Date, search?: string) {
  const docs = (await documents(tx, companyId, side, asOf)).filter((d) => !d.open.isZero());
  const prepaid = await prepayments(tx, companyId, side, asOf);
  const parties = new Map<string, PartyAging>();
  const party = (key: string, name: string) => {
    let p = parties.get(key);
    if (!p) {
      p = { partyKey: key, partyName: name, buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, dec(0)])) as Record<AgingBucket, Decimal>, prepayment: dec(0), total: dec(0), documents: [] };
      parties.set(key, p);
    }
    return p;
  };
  for (const d of docs) {
    const p = party(d.partyKey, d.partyName);
    const b = agingBucket(d.dueDate, asOf);
    p.buckets[b] = p.buckets[b].plus(d.openBase);
    p.total = p.total.plus(d.openBase);
    p.documents.push(d);
  }
  for (const [key, v] of prepaid) {
    if (v.amount.isZero()) continue;
    const p = party(key, v.name);
    p.prepayment = p.prepayment.plus(v.amount);
    p.total = p.total.minus(v.amount);
  }
  const needle = search?.trim().toLowerCase();
  const rows = [...parties.values()]
    .filter((p) => !p.total.isZero() || p.documents.length > 0)
    .filter((p) => !needle || p.partyName.toLowerCase().includes(needle))
    .sort((a, b) => a.partyName.localeCompare(b.partyName, "et"));
  for (const r of rows) r.documents.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const totals = {
    buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, rows.reduce((s, r) => s.plus(r.buckets[b]), dec(0))])) as Record<AgingBucket, Decimal>,
    prepayment: rows.reduce((s, r) => s.plus(r.prepayment), dec(0)),
    total: rows.reduce((s, r) => s.plus(r.total), dec(0)),
  };
  return { rows, totals };
}

export type PartyTurnover = { partyKey: string; partyName: string; opening: Decimal; invoiced: Decimal; paid: Decimal; closing: Decimal };

/**
 * Partnerite käibeandmik: algsaldo, perioodi arved, tasutud (sh ettemaksud ja tasaarveldused)
 * ja lõppsaldo. Tasutud = algsaldo + arved − lõppsaldo, nii et read on alati kooskõlas.
 */
export async function partyTurnover(tx: Tx, companyId: string, side: DebtSide, from: Date, to: Date, search?: string) {
  const balance = async (asOf: Date) => {
    const out = new Map<string, { name: string; amount: Decimal }>();
    const add = (key: string, name: string, v: Decimal) => {
      const cur = out.get(key);
      out.set(key, { name: cur?.name ?? name, amount: (cur?.amount ?? dec(0)).plus(v) });
    };
    for (const d of await documents(tx, companyId, side, asOf)) if (!d.open.isZero()) add(d.partyKey, d.partyName, d.openBase);
    for (const [key, v] of await prepayments(tx, companyId, side, asOf)) add(key, v.name, v.amount.negated());
    return out;
  };
  const opening = await balance(addDays(from, -1));
  const closing = await balance(to);
  const invoicedDocs = await documents(tx, companyId, side, to, from);
  const parties = new Map<string, PartyTurnover>();
  const get = (key: string, name: string) => {
    let p = parties.get(key);
    if (!p) {
      p = { partyKey: key, partyName: name, opening: dec(0), invoiced: dec(0), paid: dec(0), closing: dec(0) };
      parties.set(key, p);
    }
    return p;
  };
  for (const [k, v] of opening) get(k, v.name).opening = v.amount;
  for (const [k, v] of closing) get(k, v.name).closing = v.amount;
  for (const d of invoicedDocs) {
    const p = get(d.partyKey, d.partyName);
    p.invoiced = p.invoiced.plus(d.totalBase);
  }
  const needle = search?.trim().toLowerCase();
  const rows = [...parties.values()]
    .map((p) => ({ ...p, paid: roundMoney(p.opening.plus(p.invoiced).minus(p.closing)) }))
    .filter((p) => !(p.opening.isZero() && p.invoiced.isZero() && p.paid.isZero() && p.closing.isZero()))
    .filter((p) => !needle || p.partyName.toLowerCase().includes(needle))
    .sort((a, b) => a.partyName.localeCompare(b.partyName, "et"));
  const sumOf = (k: "opening" | "invoiced" | "paid" | "closing") => rows.reduce((s, r) => s.plus(r[k]), dec(0));
  return { rows, totals: { opening: sumOf("opening"), invoiced: sumOf("invoiced"), paid: sumOf("paid"), closing: sumOf("closing") } };
}

/** Töölaua kokkuvõte: tasumata dokumendid tähtajaga (eurodes). */
export async function openDocumentsSummary(tx: Tx, companyId: string, side: DebtSide, asOf: Date) {
  return (await documents(tx, companyId, side, asOf)).filter((d) => !d.open.isZero());
}
