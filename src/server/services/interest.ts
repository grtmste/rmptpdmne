import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { addDays, toISODate } from "@/lib/accounting/dates";
import { cashEffect } from "@/lib/payments/posting";
import { lateInterest } from "@/lib/sales/interest";
import { confirmInvoice, saveInvoiceDraft, SalesError } from "./sales";

/**
 * Viivised: arvutus tähtaja ületanud müügiarvetelt (osamaksete ja kreeditarvetega) ning
 * viivisearvete koostamine. Arvestatud vahemik salvestatakse (LateInterestCharge), et sama
 * perioodi eest viivist uuesti ei nõutaks.
 */

type Tx = Prisma.TransactionClient;

export type InterestRow = {
  invoiceId: string;
  number: string;
  currency: string;
  dueDate: Date;
  from: Date;
  to: Date;
  days: number;
  ratePct: Decimal;
  open: Decimal;
  amount: Decimal;
};

export type CustomerInterest = { customerId: string; customerName: string; locale: string; rows: InterestRow[]; total: Decimal };

export async function interestCandidates(tx: Tx, companyId: string, asOf: Date, opts: { customerId?: string | null; minAmount?: number } = {}) {
  const invoices = await tx.salesInvoice.findMany({
    where: {
      companyId,
      status: "CONFIRMED",
      type: "INVOICE",
      isInterest: false,
      dueDate: { lt: asOf },
      lateInterestPct: { gt: 0 },
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
    },
    orderBy: [{ customerName: "asc" }, { dueDate: "asc" }],
    select: { id: true, number: true, customerId: true, customerName: true, locale: true, currency: true, total: true, dueDate: true, lateInterestPct: true },
  });
  if (invoices.length === 0) return [];
  const ids = invoices.map((i) => i.id);
  const allocations = await tx.paymentAllocation.findMany({
    where: { companyId, salesInvoiceId: { in: ids }, payment: { status: "CONFIRMED", cancelledAt: null, date: { lte: asOf } } },
    select: { salesInvoiceId: true, type: true, amount: true, payment: { select: { date: true, direction: true } } },
  });
  const credits = await tx.salesInvoice.findMany({
    where: { companyId, creditOfId: { in: ids }, status: "CONFIRMED", date: { lte: asOf } },
    select: { creditOfId: true, date: true, total: true },
  });
  const charged = await tx.lateInterestCharge.groupBy({ by: ["salesInvoiceId"], where: { companyId, salesInvoiceId: { in: ids } }, _max: { toDate: true } });
  const chargedUntil = new Map(charged.map((c) => [c.salesInvoiceId, c._max.toDate]));

  const byCustomer = new Map<string, CustomerInterest>();
  for (const inv of invoices) {
    const payments = [
      ...allocations
        .filter((a) => a.salesInvoiceId === inv.id)
        .map((a) => ({ date: a.payment.date, amount: cashEffect(a.payment.direction, a.type, a.amount) })),
      ...credits.filter((c) => c.creditOfId === inv.id).map((c) => ({ date: c.date, amount: dec(c.total).negated() })),
    ];
    const last = chargedUntil.get(inv.id);
    const r = lateInterest({ amount: inv.total, dueDate: inv.dueDate, payments, from: last ? addDays(last, 1) : null, to: asOf, ratePct: inv.lateInterestPct! });
    if (r.amount.lessThan(opts.minAmount ?? 0.01)) continue;
    const open = payments.reduce((s, p) => s.minus(p.amount), dec(inv.total));
    let c = byCustomer.get(inv.customerId);
    if (!c) {
      c = { customerId: inv.customerId, customerName: inv.customerName, locale: inv.locale, rows: [], total: dec(0) };
      byCustomer.set(inv.customerId, c);
    }
    c.rows.push({
      invoiceId: inv.id,
      number: inv.number ?? "",
      currency: inv.currency,
      dueDate: inv.dueDate,
      from: r.segments[0]!.from,
      to: asOf,
      days: r.days,
      ratePct: dec(inv.lateInterestPct!),
      open: open.greaterThan(0) ? open : dec(0),
      amount: r.amount,
    });
    c.total = c.total.plus(r.amount);
  }
  return [...byCustomer.values()];
}

const LINE_TEXT: Record<string, (n: string, from: string, to: string, days: number, pct: string) => string> = {
  et: (n, f, t, d, p) => `Viivis arve ${n} eest ${f}–${t} (${d} p × ${p}%)`,
  en: (n, f, t, d, p) => `Late interest on invoice ${n}, ${f}–${t} (${d} d × ${p}%)`,
  fi: (n, f, t, d, p) => `Viivästyskorko laskusta ${n} ${f}–${t} (${d} pv × ${p} %)`,
  ru: (n, f, t, d, p) => `Пеня по счёту ${n} за ${f}–${t} (${d} дн. × ${p}%)`,
};
const dmy = (d: Date) => toISODate(d).split("-").reverse().join(".");

/** Viivisearvete tulukonto: seadistatud konto või esimene intressitulu rea konto. */
async function interestAccount(tx: Tx, companyId: string) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { interestAccountId: true } });
  if (company.interestAccountId) return company.interestAccountId;
  const acc = await tx.glAccount.findFirst({
    where: { companyId, kind: "DETAIL", active: true, reportLine: "IS_INTEREST_INCOME" },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  if (!acc) throw new SalesError("interestAccountMissing");
  return acc.id;
}

/**
 * Koostab valitud klientidele viivisearved seisuga `asOf` (üks arve kliendi kohta, rida arve kohta).
 * Viivis ei ole käive (KM-ita). `confirm` – kinnitab arved kohe.
 */
export async function createInterestInvoices(
  tx: Tx,
  companyId: string,
  userId: string | null,
  opts: { asOf: Date; date: Date; customerIds: string[]; confirm: boolean },
) {
  const accountId = await interestAccount(tx, companyId);
  const noVat = await tx.vatRate.findFirst({ where: { companyId, kind: "NOT_TAXABLE", active: true }, select: { id: true } });
  const all = await interestCandidates(tx, companyId, opts.asOf);
  const selected = all.filter((c) => opts.customerIds.includes(c.customerId));
  if (selected.length === 0) throw new SalesError("nothingToCharge");
  const created: string[] = [];
  for (const c of selected) {
    const text = LINE_TEXT[c.locale] ?? LINE_TEXT.et!;
    // Valuutaarvete viivis arvestatakse eurodes ainult EUR-arvetel; muud jäävad välja
    const rows = c.rows.filter((r) => r.currency === "EUR");
    if (rows.length === 0) continue;
    const invoiceId = await saveInvoiceDraft(tx, companyId, userId, {
      type: "INVOICE",
      customerId: c.customerId,
      date: opts.date,
      currency: "EUR",
      pricesIncludeVat: false,
      isInterest: true,
      notes: null,
      lines: rows.map((r) => ({
        description: text(r.number, dmy(r.from), dmy(r.to), r.days, r.ratePct.toDecimalPlaces(3).toString()),
        quantity: "1",
        unitPrice: r.amount.toFixed(2),
        vatRateId: noVat?.id ?? null,
        accountId,
      })),
    });
    await tx.lateInterestCharge.createMany({
      data: rows.map((r) => ({ companyId, interestInvoiceId: invoiceId, salesInvoiceId: r.invoiceId, fromDate: r.from, toDate: r.to, amount: r.amount.toFixed(2) })),
    });
    if (opts.confirm) await confirmInvoice(tx, companyId, userId, invoiceId);
    created.push(invoiceId);
  }
  if (created.length === 0) throw new SalesError("nothingToCharge");
  return created;
}
