import type { Prisma } from "@/generated/prisma/client";
import { dec, roundMoney, type DecimalInput } from "@/lib/money";
import { toBase } from "@/lib/sales/calc";
import {
  allocationDifference,
  buildPaymentPosting,
  cashEffect,
  documentShareBase,
  signedPaymentAmount,
  type AllocationKind,
  type Direction,
  type PostingPart,
} from "@/lib/payments/posting";
import { assertPeriodOpen, postJournalEntry } from "./journal";
import { nextDocumentNumber } from "./numbering";
import { exchangeRateFor, SalesError } from "./sales";

type Tx = Prisma.TransactionClient;

export type PaymentErrorCode =
  | "paymentNotFound"
  | "bankAccountRequired"
  | "bankAccountNotFound"
  | "nettingWithBank"
  | "allocationMismatch"
  | "documentNotFound"
  | "documentNotConfirmed"
  | "overpaid"
  | "currencyMismatch"
  | "accountRequired"
  | "partyRequired"
  | "alreadyCancelled"
  | "notConfirmedPayment"
  | "noAllocations"
  | "ibanMismatch"
  | "statementInvalid"
  | "statementEmpty";

/** Maksete reegli rikkumine; `code` on i18n võti nimeruumis `errors.payments`. */
export class PaymentError extends Error {
  constructor(
    public code: PaymentErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "PaymentError";
  }
}

export type AllocationInput = {
  type: AllocationKind;
  salesInvoiceId?: string | null;
  purchaseInvoiceId?: string | null;
  expenseReportId?: string | null;
  accountId?: string | null;
  amount: DecimalInput;
  description?: string | null;
};

export type PaymentInput = {
  id?: string;
  direction: Direction;
  bankAccountId?: string | null;
  date: Date;
  amount: DecimalInput;
  currencyRate?: DecimalInput | null;
  partyType: "CUSTOMER" | "SUPPLIER" | "EMPLOYEE" | "OTHER";
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  partyName?: string | null;
  partyIban?: string | null;
  referenceNumber?: string | null;
  description?: string | null;
  statementLineId?: string | null;
  paymentOrderId?: string | null;
  allocations: AllocationInput[];
};

async function role(tx: Tx, companyId: string, r: "RECEIVABLES" | "PAYABLES" | "EMPLOYEE_PAYABLES" | "CUSTOMER_PREPAYMENTS" | "SUPPLIER_PREPAYMENTS" | "FX_GAIN_LOSS") {
  const a = await tx.glAccount.findFirst({ where: { companyId, role: r }, select: { id: true } });
  if (!a) throw new SalesError("missingRoleAccount", { role: r });
  return a.id;
}

async function partyName(tx: Tx, companyId: string, input: PaymentInput) {
  if (input.partyType === "CUSTOMER" && input.customerId) {
    const c = await tx.customer.findFirst({ where: { companyId, id: input.customerId }, select: { name: true } });
    if (!c) throw new SalesError("customerNotFound");
    return c.name;
  }
  if (input.partyType === "SUPPLIER" && input.supplierId) {
    const s = await tx.supplier.findFirst({ where: { companyId, id: input.supplierId }, select: { name: true } });
    if (!s) throw new SalesError("supplierNotFound");
    return s.name;
  }
  if (input.partyType === "EMPLOYEE" && input.employeeId) {
    const e = await tx.employee.findFirst({ where: { companyId, id: input.employeeId }, select: { name: true } });
    if (!e) throw new SalesError("employeeNotFound");
    return e.name;
  }
  return input.partyName?.trim() ?? "";
}

/** Salvestab makse mustandi (kontrollib viited, mitte summasid). */
export async function savePayment(tx: Tx, companyId: string, userId: string | null, input: PaymentInput) {
  if (input.id) {
    const existing = await tx.payment.findFirst({ where: { companyId, id: input.id }, select: { status: true } });
    if (!existing) throw new PaymentError("paymentNotFound");
    if (existing.status !== "DRAFT") throw new SalesError("notDraft");
  }
  let currency = "EUR";
  if (input.direction === "NETTING") {
    if (input.bankAccountId) throw new PaymentError("nettingWithBank");
  } else {
    if (!input.bankAccountId) throw new PaymentError("bankAccountRequired");
    const bank = await tx.bankAccount.findFirst({ where: { companyId, id: input.bankAccountId }, select: { currency: true } });
    if (!bank) throw new PaymentError("bankAccountNotFound");
    currency = bank.currency;
  }
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrency: true } });
  if (input.direction === "NETTING") currency = company.baseCurrency;
  const rate = input.currencyRate && !dec(input.currencyRate).isZero() ? dec(input.currencyRate).toString() : await exchangeRateFor(tx, currency, input.date);
  const amount = input.direction === "NETTING" ? dec(0) : roundMoney(dec(input.amount).abs());
  const name = await partyName(tx, companyId, input);
  const data = {
    direction: input.direction,
    bankAccountId: input.bankAccountId || null,
    date: input.date,
    amount: amount.toFixed(2),
    currency,
    currencyRate: rate,
    amountBase: toBase(amount, rate).toFixed(2),
    partyType: input.partyType,
    customerId: input.partyType === "CUSTOMER" ? input.customerId || null : null,
    supplierId: input.partyType === "SUPPLIER" ? input.supplierId || null : null,
    employeeId: input.partyType === "EMPLOYEE" ? input.employeeId || null : null,
    partyName: name,
    partyIban: input.partyIban?.replace(/\s+/g, "").toUpperCase() || null,
    referenceNumber: input.referenceNumber?.trim() || null,
    description: input.description?.trim() || null,
    statementLineId: input.statementLineId ?? null,
    paymentOrderId: input.paymentOrderId ?? null,
  };
  const allocations = input.allocations
    .filter((a) => !dec(a.amount || 0).isZero())
    .map((a, sortOrder) => ({
      type: a.type,
      salesInvoiceId: a.type === "SALES_INVOICE" ? a.salesInvoiceId || null : null,
      purchaseInvoiceId: a.type === "PURCHASE_INVOICE" ? a.purchaseInvoiceId || null : null,
      expenseReportId: a.type === "EXPENSE_REPORT" ? a.expenseReportId || null : null,
      accountId: a.type === "ACCOUNT" ? a.accountId || null : null,
      amount: roundMoney(a.amount).toFixed(2),
      description: a.description?.trim() || null,
      sortOrder,
    }));
  if (input.id) {
    await tx.payment.update({ where: { id: input.id }, data });
    await tx.paymentAllocation.deleteMany({ where: { companyId, paymentId: input.id } });
    await tx.paymentAllocation.createMany({ data: allocations.map((a) => ({ ...a, companyId, paymentId: input.id! })) });
    return input.id;
  }
  const created = await tx.payment.create({ data: { companyId, status: "DRAFT", createdById: userId, ...data } });
  await tx.paymentAllocation.createMany({ data: allocations.map((a) => ({ ...a, companyId, paymentId: created.id })) });
  return created.id;
}

type DocInfo = { id: string; number: string | null; total: Prisma.Decimal; totalBase: Prisma.Decimal; paidTotal: Prisma.Decimal; currency: string; status: string };

/** Arve juba tasutud osa eurodes (proportsionaalselt arve eurosummast). */
function paidBaseBefore(doc: DocInfo) {
  if (doc.total.isZero()) return dec(0);
  return roundMoney(dec(doc.totalBase).times(doc.paidTotal).dividedBy(doc.total));
}

/**
 * Kinnitab makse: kontrollib sidumised (dokumendid kinnitatud, ei ületa tasumata osa, summa klapib),
 * teeb kande (raha, nõuded/kohustused, ettemaksed, kursivahe) ja uuendab arvete tasutud summa.
 */
export async function confirmPayment(tx: Tx, companyId: string, userId: string | null, id: string) {
  const payment = await tx.payment.findFirst({ where: { companyId, id }, include: { allocations: { orderBy: { sortOrder: "asc" } }, bankAccount: true } });
  if (!payment) throw new PaymentError("paymentNotFound");
  if (payment.status !== "DRAFT") throw new SalesError("notDraft");
  if (payment.allocations.length === 0) throw new PaymentError("noAllocations");
  await assertPeriodOpen(tx, companyId, payment.date, "PAYMENT");
  const direction = payment.direction as Direction;
  const diff = allocationDifference(direction, payment.amount.toString(), payment.allocations.map((a) => ({ type: a.type as AllocationKind, amount: a.amount.toString() })));
  if (!diff.isZero()) throw new PaymentError("allocationMismatch", { difference: diff.toFixed(2) });

  const parts: PostingPart[] = [];
  const rate = payment.currencyRate.toString();

  for (const [index, a] of payment.allocations.entries()) {
    const amount = dec(a.amount.toString());
    if (a.type === "SALES_INVOICE" || a.type === "PURCHASE_INVOICE" || a.type === "EXPENSE_REPORT") {
      let doc: DocInfo | null = null;
      if (a.type === "SALES_INVOICE" && a.salesInvoiceId) doc = await tx.salesInvoice.findFirst({ where: { companyId, id: a.salesInvoiceId } });
      if (a.type === "PURCHASE_INVOICE" && a.purchaseInvoiceId) doc = await tx.purchaseInvoice.findFirst({ where: { companyId, id: a.purchaseInvoiceId } });
      if (a.type === "EXPENSE_REPORT" && a.expenseReportId) {
        const r = await tx.expenseReport.findFirst({ where: { companyId, id: a.expenseReportId } });
        doc = r ? { ...r, currency: "EUR", totalBase: r.total } : null;
      }
      if (!doc) throw new PaymentError("documentNotFound", { index });
      if (doc.status !== "CONFIRMED") throw new PaymentError("documentNotConfirmed", { index, number: doc.number ?? "" });
      if (direction !== "NETTING" && doc.currency !== payment.currency) throw new PaymentError("currencyMismatch", { index, number: doc.number ?? "" });
      // Tasumata osa: sama märgiga kui arve ja mitte suurem
      const open = dec(doc.total).minus(dec(doc.paidTotal));
      const after = open.minus(amount);
      const ok = open.isZero() ? false : open.isPositive() ? !after.isNegative() && amount.isPositive() : !after.isPositive() && amount.isNegative();
      if (!ok) throw new PaymentError("overpaid", { index, number: doc.number ?? "", open: open.toFixed(2) });
      const shareBase = documentShareBase({ amount, total: doc.total, totalBase: doc.totalBase, paidBefore: doc.paidTotal, paidBaseBefore: paidBaseBefore(doc) });
      const accountId =
        a.type === "SALES_INVOICE" ? await role(tx, companyId, "RECEIVABLES") : a.type === "PURCHASE_INVOICE" ? await role(tx, companyId, "PAYABLES") : await role(tx, companyId, "EMPLOYEE_PAYABLES");
      // Müügiarve vähendab nõuet (kreedit), ost ja kuluaruanne kohustust (deebet)
      parts.push({ accountId, credit: a.type === "SALES_INVOICE" ? shareBase : shareBase.negated(), description: doc.number });
      // paidTotal uuendatakse kohe, et sama makse teine rida samale arvele arvestaks esimesega
      if (a.type === "SALES_INVOICE") await tx.salesInvoice.update({ where: { id: doc.id }, data: { paidTotal: dec(doc.paidTotal).plus(amount).toFixed(2) } });
      if (a.type === "PURCHASE_INVOICE") await tx.purchaseInvoice.update({ where: { id: doc.id }, data: { paidTotal: dec(doc.paidTotal).plus(amount).toFixed(2) } });
      if (a.type === "EXPENSE_REPORT") await tx.expenseReport.update({ where: { id: doc.id }, data: { paidTotal: dec(doc.paidTotal).plus(amount).toFixed(2) } });
    } else if (a.type === "PREPAYMENT") {
      if (payment.partyType !== "CUSTOMER" && payment.partyType !== "SUPPLIER") throw new PaymentError("partyRequired", { index });
      const accountId = await role(tx, companyId, payment.partyType === "CUSTOMER" ? "CUSTOMER_PREPAYMENTS" : "SUPPLIER_PREPAYMENTS");
      parts.push({ accountId, credit: toBase(cashEffect(direction, "PREPAYMENT", amount), rate), description: a.description });
    } else {
      if (!a.accountId) throw new PaymentError("accountRequired", { index });
      const account = await tx.glAccount.findFirst({ where: { companyId, id: a.accountId }, select: { id: true } });
      if (!account) throw new SalesError("accountNotFound", { index });
      parts.push({ accountId: account.id, credit: toBase(cashEffect(direction, "ACCOUNT", amount), rate), description: a.description });
    }
  }

  const cashBase = toBase(signedPaymentAmount(direction, payment.amount.toString()), rate);
  const rows = buildPaymentPosting({
    cashAccountId: payment.bankAccount?.accountId ?? null,
    cashBase,
    parts,
    fxAccountId: await role(tx, companyId, "FX_GAIN_LOSS"),
  });
  const number = await nextDocumentNumber(tx, companyId, "PAYMENT", payment.date);
  let journalEntryId: string | null = null;
  if (rows.length > 0) {
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: payment.date,
      source: "PAYMENT",
      sourceId: payment.id,
      number,
      description: [payment.partyName, payment.description].filter(Boolean).join(" – ") || null,
      lines: rows.map((r) => ({ accountId: r.accountId, debit: r.debit.toFixed(2), credit: r.credit.toFixed(2), description: r.description ?? null })),
    });
    journalEntryId = entry.id;
  }
  const res = await tx.payment.updateMany({
    where: { companyId, id, status: "DRAFT" },
    data: { status: "CONFIRMED", number, journalEntryId, confirmedAt: new Date(), confirmedById: userId },
  });
  if (res.count !== 1) throw new SalesError("notDraft");
  return { id, number };
}

/** Arvete tasutud summa uuesti kehtivatest (kinnitatud, tühistamata) sidumistest. */
export async function recomputePaid(tx: Tx, companyId: string, ids: { sales?: string[]; purchase?: string[]; expense?: string[] }) {
  const sumFor = async (field: "salesInvoiceId" | "purchaseInvoiceId" | "expenseReportId", id: string) => {
    const r = await tx.paymentAllocation.aggregate({
      where: { companyId, [field]: id, payment: { status: "CONFIRMED", cancelledAt: null } },
      _sum: { amount: true },
    });
    return dec(r._sum.amount ?? 0).toFixed(2);
  };
  for (const id of ids.sales ?? []) await tx.salesInvoice.update({ where: { id }, data: { paidTotal: await sumFor("salesInvoiceId", id) } });
  for (const id of ids.purchase ?? []) await tx.purchaseInvoice.update({ where: { id }, data: { paidTotal: await sumFor("purchaseInvoiceId", id) } });
  for (const id of ids.expense ?? []) await tx.expenseReport.update({ where: { id }, data: { paidTotal: await sumFor("expenseReportId", id) } });
}

export async function deletePaymentDraft(tx: Tx, companyId: string, id: string) {
  const payment = await tx.payment.findFirst({ where: { companyId, id }, select: { status: true, statementLineId: true } });
  if (!payment) throw new PaymentError("paymentNotFound");
  if (payment.status !== "DRAFT") throw new SalesError("notDraft");
  await tx.payment.delete({ where: { id } });
}

/**
 * Kinnitatud makse tühistamine (storno): pöördkanne tühistamise kuupäevaga, sidumised ei loe
 * enam arvete tasumisse, väljavõtte rida vabaneb uueks sobitamiseks.
 */
export async function cancelPayment(tx: Tx, companyId: string, userId: string | null, id: string, date: Date) {
  const payment = await tx.payment.findFirst({ where: { companyId, id }, include: { allocations: true } });
  if (!payment) throw new PaymentError("paymentNotFound");
  if (payment.status !== "CONFIRMED") throw new PaymentError("notConfirmedPayment");
  if (payment.cancelledAt) throw new PaymentError("alreadyCancelled");
  let cancelEntryId: string | null = null;
  if (payment.journalEntryId) {
    const entry = await tx.journalEntry.findFirst({ where: { companyId, id: payment.journalEntryId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    if (entry) {
      const reversal = await postJournalEntry(tx, companyId, userId, {
        date,
        source: "PAYMENT",
        sourceId: payment.id,
        reversalOfId: entry.id,
        description: `Storno: ${payment.number ?? ""}`.trim(),
        lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit.toString(), credit: l.debit.toString(), description: l.description })),
      });
      cancelEntryId = reversal.id;
    }
  }
  await tx.payment.update({ where: { id }, data: { cancelledAt: new Date(), cancelEntryId } });
  await recomputePaid(tx, companyId, {
    sales: payment.allocations.flatMap((a) => (a.salesInvoiceId ? [a.salesInvoiceId] : [])),
    purchase: payment.allocations.flatMap((a) => (a.purchaseInvoiceId ? [a.purchaseInvoiceId] : [])),
    expense: payment.allocations.flatMap((a) => (a.expenseReportId ? [a.expenseReportId] : [])),
  });
  if (payment.statementLineId) {
    await tx.bankStatementLine.updateMany({ where: { companyId, id: payment.statementLineId }, data: { status: "NEW", paymentId: null } });
  }
}

// ---------------------------------------------------------------------------
// Avatud kirjed (tasumata arved)
// ---------------------------------------------------------------------------

export type OpenItem = {
  type: "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT";
  id: string;
  number: string;
  partyId: string | null;
  partyName: string;
  date: Date;
  dueDate: Date | null;
  currency: string;
  total: string;
  open: string;
  referenceNumber: string | null;
  invoiceNumber?: string | null;
};

const hasOpen = { NOT: { total: { equals: 0 } } };

/** Tasumata kinnitatud dokumendid (avatud summa ≠ 0). */
export async function openItems(
  tx: Tx,
  companyId: string,
  opts: { types?: Array<OpenItem["type"]>; customerId?: string; supplierId?: string; employeeId?: string; limit?: number } = {},
): Promise<OpenItem[]> {
  const types = opts.types ?? ["SALES_INVOICE", "PURCHASE_INVOICE", "EXPENSE_REPORT"];
  const limit = opts.limit ?? 500;
  const items: OpenItem[] = [];
  if (types.includes("SALES_INVOICE")) {
    const rows = await tx.salesInvoice.findMany({
      where: { companyId, status: "CONFIRMED", ...hasOpen, ...(opts.customerId ? { customerId: opts.customerId } : {}) },
      orderBy: [{ dueDate: "asc" }, { date: "asc" }],
      take: limit * 2,
    });
    for (const r of rows) {
      const open = dec(r.total).minus(dec(r.paidTotal));
      if (open.isZero()) continue;
      items.push({ type: "SALES_INVOICE", id: r.id, number: r.number ?? "", partyId: r.customerId, partyName: r.customerName, date: r.date, dueDate: r.dueDate, currency: r.currency, total: r.total.toFixed(2), open: open.toFixed(2), referenceNumber: r.referenceNumber });
    }
  }
  if (types.includes("PURCHASE_INVOICE")) {
    const rows = await tx.purchaseInvoice.findMany({
      where: { companyId, status: "CONFIRMED", ...hasOpen, ...(opts.supplierId ? { supplierId: opts.supplierId } : {}) },
      orderBy: [{ dueDate: "asc" }, { date: "asc" }],
      take: limit * 2,
    });
    for (const r of rows) {
      const open = dec(r.total).minus(dec(r.paidTotal));
      if (open.isZero()) continue;
      items.push({ type: "PURCHASE_INVOICE", id: r.id, number: r.number ?? "", partyId: r.supplierId, partyName: r.supplierName, date: r.date, dueDate: r.dueDate, currency: r.currency, total: r.total.toFixed(2), open: open.toFixed(2), referenceNumber: r.referenceNumber, invoiceNumber: r.invoiceNumber });
    }
  }
  if (types.includes("EXPENSE_REPORT")) {
    const rows = await tx.expenseReport.findMany({
      where: { companyId, status: "CONFIRMED", ...hasOpen, ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) },
      orderBy: { date: "asc" },
      take: limit * 2,
    });
    for (const r of rows) {
      const open = dec(r.total).minus(dec(r.paidTotal));
      if (open.isZero()) continue;
      items.push({ type: "EXPENSE_REPORT", id: r.id, number: r.number ?? "", partyId: r.employeeId, partyName: r.employeeName, date: r.date, dueDate: null, currency: "EUR", total: r.total.toFixed(2), open: open.toFixed(2), referenceNumber: null });
    }
  }
  return items.slice(0, limit);
}

