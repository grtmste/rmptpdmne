import type { Prisma } from "@/generated/prisma/client";
import { resolveVatRate } from "@/lib/accounting/vat";
import { referenceNumber } from "@/lib/accounting/numbering";
import { toISODate } from "@/lib/accounting/dates";
import { dec, roundMoney, sum, type DecimalInput } from "@/lib/money";
import { buildSalesPosting, calculateDocument, dueDateFrom, toBase, type VatKindLike } from "@/lib/sales/calc";
import { assertPeriodOpen, postJournalEntry } from "./journal";
import { nextDocumentNumber } from "./numbering";

type Tx = Prisma.TransactionClient;

export type SalesErrorCode =
  | "customerNotFound"
  | "itemNotFound"
  | "accountNotFound"
  | "vatRateNotFound"
  | "vatRateNotValid"
  | "noLines"
  | "lineDescription"
  | "invoiceNotFound"
  | "notDraft"
  | "notConfirmed"
  | "missingRoleAccount"
  | "noExchangeRate"
  | "creditNotNegative"
  | "creditExceedsOriginal"
  | "cannotCredit"
  | "prepaymentNotFound"
  | "noExportVat"
  | "nothingTaxable"
  | "quoteNotFound"
  | "quoteInvoiced"
  | "vatAccountMissing"
  // Ost (faas 4)
  | "supplierNotFound"
  | "supplierRequired"
  | "invoiceNumberRequired"
  | "duplicateInvoiceNumber"
  | "orderNotFound"
  | "orderInvoiced"
  | "employeeNotFound"
  | "reportNotFound"
  | "attachmentTooLarge"
  | "attachmentType";

/** Müügi ja ostu dokumendireegli rikkumine; `code` on i18n võti nimeruumis `errors.sales`. */
export class SalesError extends Error {
  constructor(
    public code: SalesErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "SalesError";
  }
}

export type SalesLineInput = {
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
  unitCost?: DecimalInput | null;
  prepaymentInvoiceId?: string | null;
};

export type InvoiceType = "INVOICE" | "CREDIT" | "PREPAYMENT";

export type InvoiceInput = {
  id?: string;
  type: InvoiceType;
  customerId: string;
  date: Date;
  dueDate?: Date | null;
  deliveryDate?: Date | null;
  currency?: string;
  currencyRate?: DecimalInput | null;
  pricesIncludeVat: boolean;
  yourReference?: string | null;
  notes?: string | null;
  creditOfId?: string | null;
  taxFree?: boolean;
  quoteId?: string | null;
  lines: SalesLineInput[];
};

const isBlank = (v: DecimalInput | null | undefined) => v === null || v === undefined || v === "";

export function customerAddress(c: {
  addressStreet: string | null;
  addressPostalCode: string | null;
  addressCity: string | null;
  addressCounty: string | null;
  countryCode: string;
}) {
  const city = [c.addressPostalCode, c.addressCity].filter(Boolean).join(" ");
  const parts = [c.addressStreet, city, c.addressCounty, c.countryCode !== "EE" ? c.countryCode : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export async function roleAccount(
  tx: Tx,
  companyId: string,
  role: "RECEIVABLES" | "DEFAULT_SALES" | "CUSTOMER_PREPAYMENTS" | "PAYABLES" | "DEFAULT_PURCHASE" | "EMPLOYEE_PAYABLES",
) {
  const a = await tx.glAccount.findFirst({ where: { companyId, role }, select: { id: true } });
  if (!a) throw new SalesError("missingRoleAccount", { role });
  return a.id;
}

/** Valuutakurss dokumendi kuupäeval (1 EUR = kurss valuutat); viimane teadaolev kuni kuupäevani. */
export async function exchangeRateFor(tx: Tx, currency: string, date: Date): Promise<string> {
  if (currency === "EUR") return "1";
  const rate = await tx.exchangeRate.findFirst({
    where: { currency, date: { lte: date } },
    orderBy: { date: "desc" },
    select: { rate: true },
  });
  if (!rate) throw new SalesError("noExchangeRate", { currency, date: toISODate(date) });
  return rate.rate.toString();
}

type PreparedLine = {
  itemId: string | null;
  code: string | null;
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discountPct: string;
  vatRateId: string | null;
  vatPct: string;
  vatKind: VatKindLike | null;
  accountId: string | null;
  departmentId: string | null;
  dimensionValueIds: string[];
  unitCost: string | null;
  prepaymentInvoiceId: string | null;
  netAmount: string;
  vatAmount: string;
  marginVatAmount: string;
};

/**
 * Kontrollib read ja arvutab summad. Käibemaksumäär leitakse kuupäeva järgi; kreeditarvel algse
 * arve kuupäeva ja ettemaksu tasaarveldusel ettemaksuarve kuupäeva järgi (algse määraga).
 */
async function prepareLines(
  tx: Tx,
  companyId: string,
  opts: {
    date: Date;
    rateDate?: Date | null;
    pricesIncludeVat: boolean;
    lines: SalesLineInput[];
    /** Arvel on konto kohustuslik (vaikimisi tulukonto); pakkumisel mitte */
    defaultAccountId?: string | null;
    prepaymentAccountId?: string | null;
    customerId?: string;
  },
) {
  const lines = opts.lines.filter((l) => l.description.trim() || l.itemId || !dec(l.unitPrice || 0).isZero());
  const ids = <K extends keyof SalesLineInput>(k: K) => [...new Set(lines.map((l) => l[k]).filter(Boolean) as string[])];
  // Tehingus järjest (üks ühendus ei luba paralleelseid päringuid)
  const vatRates = await tx.vatRate.findMany({ where: { companyId, id: { in: ids("vatRateId") } }, include: { periods: true } });
  const items = await tx.item.findMany({ where: { companyId, id: { in: ids("itemId") } } });
  const accounts = await tx.glAccount.findMany({ where: { companyId, id: { in: ids("accountId") } }, select: { id: true } });
  const prepayments = await tx.salesInvoice.findMany({
    where: { companyId, id: { in: ids("prepaymentInvoiceId") }, type: "PREPAYMENT", status: "CONFIRMED" },
    select: { id: true, date: true, customerId: true },
  });
  const vatById = new Map(vatRates.map((v) => [v.id, v]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const accountIds = new Set(accounts.map((a) => a.id));
  const prepaymentById = new Map(prepayments.map((p) => [p.id, p]));

  const prepared = lines.map((l, index): Omit<PreparedLine, "netAmount" | "vatAmount" | "marginVatAmount"> => {
    if (l.itemId && !itemById.has(l.itemId)) throw new SalesError("itemNotFound", { index });
    const item = l.itemId ? itemById.get(l.itemId)! : null;
    const description = l.description.trim() || item?.name || "";
    if (!description) throw new SalesError("lineDescription", { index });
    if (l.accountId && !accountIds.has(l.accountId)) throw new SalesError("accountNotFound", { index });
    let rateDate = opts.rateDate ?? opts.date;
    let accountId = l.accountId || item?.salesAccountId || opts.defaultAccountId || null;
    if (l.prepaymentInvoiceId) {
      const p = prepaymentById.get(l.prepaymentInvoiceId);
      if (!p || (opts.customerId && p.customerId !== opts.customerId)) throw new SalesError("prepaymentNotFound", { index });
      rateDate = p.date;
      accountId = opts.prepaymentAccountId ?? accountId;
    } else if (opts.prepaymentAccountId && opts.defaultAccountId === opts.prepaymentAccountId) {
      // Ettemaksuarve read lähevad alati ettemaksete kontole
      accountId = opts.prepaymentAccountId;
    }
    const vatRateId = l.vatRateId || null;
    let vatPct = "0";
    let vatKind: VatKindLike | null = null;
    if (vatRateId) {
      const v = vatById.get(vatRateId);
      if (!v) throw new SalesError("vatRateNotFound", { index });
      const pct = resolveVatRate(v.periods, rateDate);
      if (pct === null) throw new SalesError("vatRateNotValid", { index, vat: v.code, date: toISODate(rateDate) });
      vatPct = pct.toFixed(2);
      vatKind = v.kind;
    }
    return {
      itemId: item?.id ?? null,
      code: l.code?.trim() || item?.code || null,
      description,
      quantity: dec(isBlank(l.quantity) ? 0 : l.quantity).toFixed(4),
      unit: l.unit?.trim() || item?.unit || null,
      unitPrice: dec(isBlank(l.unitPrice) ? 0 : l.unitPrice).toFixed(4),
      discountPct: dec(l.discountPct ?? 0).toFixed(2),
      vatRateId,
      vatPct,
      vatKind,
      accountId,
      departmentId: l.departmentId || null,
      dimensionValueIds: (l.dimensionValueIds ?? []).filter(Boolean),
      unitCost: vatKind === "MARGIN" ? dec(isBlank(l.unitCost) ? (item?.purchasePrice ?? 0) : l.unitCost).toFixed(4) : null,
      prepaymentInvoiceId: l.prepaymentInvoiceId || null,
    };
  });

  const calc = calculateDocument(prepared, { pricesIncludeVat: opts.pricesIncludeVat });
  const rows: PreparedLine[] = prepared.map((p, i) => ({
    ...p,
    netAmount: calc.lines[i]!.net.toFixed(2),
    vatAmount: calc.lines[i]!.vat.toFixed(2),
    marginVatAmount: calc.lines[i]!.marginVat.toFixed(2),
  }));
  return { rows, calc, vatById };
}

/** Objekt ilma etteantud väljadeta. */
function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

function lineData(rows: PreparedLine[]) {
  return rows.map((r, sortOrder) => ({ ...omit(r, "vatKind"), sortOrder }));
}

/** Arve read: konto on alati olemas (vaikimisi tulu- või ettemaksete konto). */
function invoiceLineData(rows: PreparedLine[], companyId: string, invoiceId: string) {
  return lineData(rows).map((r) => {
    if (!r.accountId) throw new SalesError("accountNotFound", { index: r.sortOrder });
    return { ...r, accountId: r.accountId, companyId, invoiceId };
  });
}

async function loadCustomer(tx: Tx, companyId: string, customerId: string) {
  const c = await tx.customer.findFirst({ where: { companyId, id: customerId } });
  if (!c) throw new SalesError("customerNotFound");
  return c;
}

function customerSnapshot(c: Awaited<ReturnType<typeof loadCustomer>>) {
  return {
    customerName: c.name,
    customerRegCode: c.regCode,
    customerVatNumber: c.vatNumber,
    customerAddress: customerAddress(c),
    customerEmail: c.email,
  };
}

async function companyDefaults(tx: Tx, companyId: string) {
  return tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { paymentTermDays: true, lateInterestPct: true, baseCurrency: true, invoiceNote: true },
  });
}

/** Salvestab arve mustandi. Number antakse alles kinnitamisel. */
export async function saveInvoiceDraft(tx: Tx, companyId: string, userId: string | null, input: InvoiceInput) {
  const customer = await loadCustomer(tx, companyId, input.customerId);
  const company = await companyDefaults(tx, companyId);
  let existing: { id: string; type: InvoiceType; creditOfId: string | null; taxFree: boolean; quoteId: string | null } | null = null;
  if (input.id) {
    existing = await tx.salesInvoice.findFirst({
      where: { companyId, id: input.id },
      select: { id: true, status: true, type: true, creditOfId: true, taxFree: true, quoteId: true },
    }).then((r) => {
      if (!r) throw new SalesError("invoiceNotFound");
      if (r.status !== "DRAFT") throw new SalesError("notDraft");
      return r;
    });
  }
  // Liik ja seos algse arvega ei muutu pärast loomist
  const type = existing?.type ?? input.type;
  const creditOfId = existing ? existing.creditOfId : (input.creditOfId ?? null);
  let creditOf: { date: Date } | null = null;
  if (creditOfId) {
    creditOf = await tx.salesInvoice.findFirst({
      where: { companyId, id: creditOfId, status: "CONFIRMED", customerId: input.customerId },
      select: { date: true },
    });
    if (!creditOf) throw new SalesError("cannotCredit");
  }

  const prepaymentAccountId = await roleAccount(tx, companyId, "CUSTOMER_PREPAYMENTS");
  const defaultAccountId = type === "PREPAYMENT" ? prepaymentAccountId : await roleAccount(tx, companyId, "DEFAULT_SALES");
  const { rows, calc } = await prepareLines(tx, companyId, {
    date: input.date,
    rateDate: creditOf?.date ?? null,
    pricesIncludeVat: input.pricesIncludeVat,
    lines: input.lines,
    defaultAccountId,
    prepaymentAccountId,
    customerId: input.customerId,
  });

  const currency = input.currency || customer.currency || company.baseCurrency;
  const currencyRate = isBlank(input.currencyRate)
    ? await exchangeRateFor(tx, currency, input.date)
    : dec(input.currencyRate!).toString();
  const days = customer.paymentTermDays ?? company.paymentTermDays;
  const data = {
    customerId: customer.id,
    ...customerSnapshot(customer),
    date: input.date,
    dueDate: input.dueDate ?? dueDateFrom(input.date, type === "CREDIT" ? 0 : days),
    deliveryDate: input.deliveryDate ?? null,
    currency,
    currencyRate,
    pricesIncludeVat: input.pricesIncludeVat,
    locale: customer.locale,
    yourReference: input.yourReference ?? null,
    notes: input.notes ?? null,
    lateInterestPct: customer.lateInterestPct ?? company.lateInterestPct,
    netTotal: calc.net.toFixed(2),
    vatTotal: calc.vat.toFixed(2),
    total: calc.total.toFixed(2),
    totalBase: toBase(calc.total, currencyRate).toFixed(2),
  };

  if (existing) {
    await tx.salesInvoice.update({ where: { id: existing.id }, data });
    await tx.salesInvoiceLine.deleteMany({ where: { companyId, invoiceId: existing.id } });
    await tx.salesInvoiceLine.createMany({ data: invoiceLineData(rows, companyId, existing.id) });
    return existing.id;
  }
  const created = await tx.salesInvoice.create({
    data: {
      companyId,
      type,
      status: "DRAFT",
      creditOfId,
      taxFree: input.taxFree ?? false,
      quoteId: input.quoteId ?? null,
      createdById: userId,
      ...data,
      notes: input.notes ?? (type === "INVOICE" ? company.invoiceNote : null),
    },
  });
  await tx.salesInvoiceLine.createMany({ data: invoiceLineData(rows, companyId, created.id) });
  return created.id;
}

const SERIES = { INVOICE: "SALES_INVOICE", CREDIT: "CREDIT_INVOICE", PREPAYMENT: "PREPAYMENT_INVOICE" } as const;

/**
 * Kinnitab arve: arvutab summad uuesti, kontrollib reegleid, annab numbri ja viitenumbri ning
 * teeb pearaamatu kande. Kinnitatud arvet muuta ei saa.
 */
export async function confirmInvoice(tx: Tx, companyId: string, userId: string | null, id: string) {
  const invoice = await tx.salesInvoice.findFirst({
    where: { companyId, id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, customer: true, creditOf: true },
  });
  if (!invoice) throw new SalesError("invoiceNotFound");
  if (invoice.status !== "DRAFT") throw new SalesError("notDraft");
  if (invoice.lines.length === 0) throw new SalesError("noLines");
  await assertPeriodOpen(tx, companyId, invoice.date, "SALES_INVOICE");

  // Arvutame uuesti, et kinnitatud summad vastaksid kehtivatele määradele ja reeglitele
  const prepaymentAccountId = await roleAccount(tx, companyId, "CUSTOMER_PREPAYMENTS");
  const defaultAccountId = invoice.type === "PREPAYMENT" ? prepaymentAccountId : await roleAccount(tx, companyId, "DEFAULT_SALES");
  const { rows, calc, vatById } = await prepareLines(tx, companyId, {
    date: invoice.date,
    rateDate: invoice.creditOf?.date ?? null,
    pricesIncludeVat: invoice.pricesIncludeVat,
    lines: invoice.lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
      unitCost: l.unitCost?.toString() ?? null,
    })),
    defaultAccountId,
    prepaymentAccountId,
    customerId: invoice.customerId,
  });

  if (invoice.type === "CREDIT") {
    if (!calc.total.isNegative()) throw new SalesError("creditNotNegative");
    if (invoice.creditOf && !invoice.taxFree) {
      const credited = await tx.salesInvoice.aggregate({
        where: { companyId, creditOfId: invoice.creditOf.id, status: "CONFIRMED", taxFree: false },
        _sum: { total: true },
      });
      const remaining = dec(invoice.creditOf.total).plus(dec(credited._sum.total ?? 0));
      if (calc.total.negated().greaterThan(remaining)) {
        throw new SalesError("creditExceedsOriginal", { remaining: remaining.toFixed(2) });
      }
    }
  }

  const vatAccounts = new Map<string, string>();
  for (const r of rows) {
    if (!r.vatRateId) continue;
    const v = vatById.get(r.vatRateId)!;
    const hasVat = !dec(r.vatAmount).isZero() || !dec(r.marginVatAmount).isZero();
    if (hasVat && !v.salesAccountId) throw new SalesError("vatAccountMissing", { vat: v.code });
    if (v.salesAccountId) vatAccounts.set(v.id, v.salesAccountId);
  }

  const number = await nextDocumentNumber(tx, companyId, SERIES[invoice.type], invoice.date);
  const digits = number.replace(/\D/g, "");
  const reference = invoice.customer.referenceNumber || (digits ? referenceNumber(digits) : null);
  const receivableAccountId = await roleAccount(tx, companyId, "RECEIVABLES");

  const posting = buildSalesPosting({
    receivableAccountId,
    vatAccounts,
    currencyRate: invoice.currencyRate.toString(),
    lines: rows.map((r) => ({
      accountId: r.accountId!,
      departmentId: r.departmentId,
      dimensionValueIds: r.dimensionValueIds,
      vatRateId: r.vatRateId,
      net: r.netAmount,
      vat: r.vatAmount,
      marginVat: r.marginVatAmount,
    })),
  });
  let journalEntryId: string | null = null;
  if (posting.length > 0) {
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: invoice.date,
      source: "SALES_INVOICE",
      sourceId: invoice.id,
      number,
      description: `${invoice.customerName}`,
      lines: posting.map((p) => ({
        accountId: p.accountId,
        debit: p.debit.toFixed(2),
        credit: p.credit.toFixed(2),
        departmentId: p.departmentId ?? null,
        vatRateId: p.vatRateId ?? null,
        vatAmount: p.vatAmount ? p.vatAmount.toFixed(2) : null,
        dimensionValueIds: p.dimensionValueIds ?? [],
      })),
    });
    journalEntryId = entry.id;
  }

  const res = await tx.salesInvoice.updateMany({
    where: { companyId, id, status: "DRAFT" },
    data: {
      status: "CONFIRMED",
      number,
      referenceNumber: reference,
      journalEntryId,
      confirmedAt: new Date(),
      confirmedById: userId,
      netTotal: calc.net.toFixed(2),
      vatTotal: calc.vat.toFixed(2),
      total: calc.total.toFixed(2),
      totalBase: toBase(calc.total, invoice.currencyRate.toString()).toFixed(2),
    },
  });
  if (res.count !== 1) throw new SalesError("notDraft");
  await tx.salesInvoiceLine.deleteMany({ where: { companyId, invoiceId: id } });
  await tx.salesInvoiceLine.createMany({ data: invoiceLineData(rows, companyId, id) });
  return { id, number };
}

export async function deleteInvoiceDraft(tx: Tx, companyId: string, id: string) {
  const invoice = await tx.salesInvoice.findFirst({ where: { companyId, id }, select: { status: true, quoteId: true } });
  if (!invoice) throw new SalesError("invoiceNotFound");
  if (invoice.status !== "DRAFT") throw new SalesError("notDraft");
  await tx.salesInvoice.delete({ where: { id } });
  // Pakkumine vabaneb uuesti arveks tegemiseks
  if (invoice.quoteId) {
    await tx.quote.updateMany({ where: { companyId, id: invoice.quoteId, invoiceId: id }, data: { status: "ACCEPTED", invoiceId: null } });
  }
}

async function loadConfirmed(tx: Tx, companyId: string, id: string) {
  const invoice = await tx.salesInvoice.findFirst({
    where: { companyId, id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!invoice) throw new SalesError("invoiceNotFound");
  if (invoice.status !== "CONFIRMED") throw new SalesError("notConfirmed");
  return invoice;
}

const lineInput = (l: Prisma.SalesInvoiceLineGetPayload<object>, patch: Partial<SalesLineInput> = {}): SalesLineInput => ({
  itemId: l.itemId,
  code: l.code,
  description: l.description,
  quantity: l.quantity.toString(),
  unit: l.unit,
  unitPrice: l.unitPrice.toString(),
  discountPct: l.discountPct.toString(),
  vatRateId: l.vatRateId,
  accountId: l.accountId,
  departmentId: l.departmentId,
  dimensionValueIds: l.dimensionValueIds,
  unitCost: l.unitCost?.toString() ?? null,
  prepaymentInvoiceId: l.prepaymentInvoiceId,
  ...patch,
});

/**
 * Kreeditarve mustand kinnitatud arvest: samad read negatiivse kogusega ja algse arve
 * käibemaksumääraga. Kasutaja võib enne kinnitamist read ja kogused üle vaadata.
 */
export async function createCreditDraft(tx: Tx, companyId: string, userId: string | null, originalId: string, date: Date) {
  const original = await loadConfirmed(tx, companyId, originalId);
  if (original.type === "CREDIT") throw new SalesError("cannotCredit");
  return saveInvoiceDraft(tx, companyId, userId, {
    type: "CREDIT",
    customerId: original.customerId,
    date,
    dueDate: date,
    currency: original.currency,
    currencyRate: original.currencyRate.toString(),
    pricesIncludeVat: original.pricesIncludeVat,
    creditOfId: original.id,
    yourReference: original.yourReference,
    notes: null,
    lines: original.lines.map((l) => lineInput(l, { quantity: dec(l.quantity).negated().toString() })),
  });
}

/**
 * Tax-free korrigeerimine (KMS § 15 lg 3 p 2 ja lg 5): reisijale käibemaksuga müüdud kaup, mille
 * väljavedu on kinnitatud, muudetakse 0% ekspordiks. Kreeditarvel tühistatakse algne maksustatav
 * käive ja lisatakse sama summa 0% ekspordina – arve summa on tagastatav käibemaks.
 */
export async function createTaxFreeDraft(tx: Tx, companyId: string, userId: string | null, originalId: string, date: Date) {
  const original = await loadConfirmed(tx, companyId, originalId);
  if (original.type !== "INVOICE") throw new SalesError("cannotCredit");
  const exportVat = await tx.vatRate.findFirst({
    where: { companyId, kind: "ZERO_EXPORT", active: true },
    orderBy: { sortOrder: "asc" },
  });
  if (!exportVat) throw new SalesError("noExportVat");
  const exportAccount = await tx.glAccount.findFirst({
    where: { companyId, defaultVatRateId: exportVat.id, active: true, kind: "DETAIL", vatTurnover: "SALES" },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  const rateIds = [...new Set(original.lines.map((l) => l.vatRateId).filter(Boolean) as string[])];
  const taxableIds = new Set(
    (await tx.vatRate.findMany({ where: { companyId, id: { in: rateIds }, kind: "TAXABLE" }, select: { id: true } })).map((v) => v.id),
  );
  const taxable = original.lines.filter((l) => l.vatRateId && taxableIds.has(l.vatRateId) && !dec(l.vatAmount).isZero());
  if (taxable.length === 0) throw new SalesError("nothingTaxable");
  const lines: SalesLineInput[] = taxable.flatMap((l) => [
    lineInput(l, { quantity: "-1", unitPrice: l.netAmount.toString(), discountPct: "0", prepaymentInvoiceId: null }),
    lineInput(l, {
      quantity: "1",
      unitPrice: l.netAmount.toString(),
      discountPct: "0",
      vatRateId: exportVat.id,
      accountId: exportAccount?.id ?? l.accountId,
      prepaymentInvoiceId: null,
    }),
  ]);
  return saveInvoiceDraft(tx, companyId, userId, {
    type: "CREDIT",
    customerId: original.customerId,
    date,
    dueDate: date,
    currency: original.currency,
    currencyRate: original.currencyRate.toString(),
    pricesIncludeVat: false,
    creditOfId: original.id,
    taxFree: true,
    notes: exportVat.invoiceNote ?? null,
    lines,
  });
}

/** Uus mustand olemasoleva arve põhjal (sama klient ja read, uus kuupäev). */
export async function copyInvoice(tx: Tx, companyId: string, userId: string | null, id: string, date: Date) {
  const source = await tx.salesInvoice.findFirst({
    where: { companyId, id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) throw new SalesError("invoiceNotFound");
  return saveInvoiceDraft(tx, companyId, userId, {
    type: source.type === "CREDIT" ? "INVOICE" : source.type,
    customerId: source.customerId,
    date,
    currency: source.currency,
    pricesIncludeVat: source.pricesIncludeVat,
    yourReference: source.yourReference,
    notes: source.notes,
    lines: source.lines
      .filter((l) => !l.prepaymentInvoiceId)
      .map((l) => lineInput(l, { quantity: source.type === "CREDIT" ? dec(l.quantity).negated().toString() : l.quantity.toString() })),
  });
}

/** Ettemaksuarved, mida saab lõpparvel tasaarveldada (kinnitatud ja veel mahaarvamata osaga). */
export async function openPrepayments(tx: Tx, companyId: string, customerId?: string) {
  const prepayments = await tx.salesInvoice.findMany({
    where: { companyId, type: "PREPAYMENT", status: "CONFIRMED", ...(customerId ? { customerId } : {}) },
    orderBy: { date: "desc" },
    take: 200,
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (prepayments.length === 0) return [];
  const used = await tx.salesInvoiceLine.groupBy({
    by: ["prepaymentInvoiceId", "vatRateId"],
    where: { companyId, prepaymentInvoiceId: { in: prepayments.map((p) => p.id) }, invoice: { status: "CONFIRMED" } },
    _sum: { netAmount: true },
  });
  const usedKey = (p: string, v: string | null) => `${p}|${v ?? ""}`;
  const usedMap = new Map(used.map((u) => [usedKey(u.prepaymentInvoiceId!, u.vatRateId), dec(u._sum.netAmount ?? 0)]));
  return prepayments
    .map((p) => {
      const byVat = new Map<string, { vatRateId: string | null; net: ReturnType<typeof dec> }>();
      for (const l of p.lines) {
        const k = l.vatRateId ?? "";
        byVat.set(k, { vatRateId: l.vatRateId, net: (byVat.get(k)?.net ?? dec(0)).plus(dec(l.netAmount)) });
      }
      const remaining = [...byVat.values()]
        .map((g) => ({ vatRateId: g.vatRateId, net: roundMoney(g.net.plus(usedMap.get(usedKey(p.id, g.vatRateId)) ?? 0)) }))
        .filter((g) => g.net.greaterThan(0));
      return {
        id: p.id,
        number: p.number!,
        customerId: p.customerId,
        date: p.date,
        currency: p.currency,
        remaining: remaining.map((g) => ({ vatRateId: g.vatRateId, net: g.net.toFixed(2) })),
        remainingTotal: sum(remaining.map((g) => g.net)).toFixed(2),
      };
    })
    .filter((p) => p.remaining.length > 0);
}

// ---------------------------------------------------------------------------
// Pakkumised
// ---------------------------------------------------------------------------

export type QuoteInput = {
  id?: string;
  customerId: string;
  date: Date;
  validUntil?: Date | null;
  currency?: string;
  pricesIncludeVat: boolean;
  yourReference?: string | null;
  notes?: string | null;
  lines: SalesLineInput[];
};

export async function saveQuote(tx: Tx, companyId: string, userId: string | null, input: QuoteInput) {
  const customer = await loadCustomer(tx, companyId, input.customerId);
  const company = await companyDefaults(tx, companyId);
  if (input.id) {
    const existing = await tx.quote.findFirst({ where: { companyId, id: input.id }, select: { status: true } });
    if (!existing) throw new SalesError("quoteNotFound");
    if (existing.status === "INVOICED") throw new SalesError("quoteInvoiced");
  }
  const { rows, calc } = await prepareLines(tx, companyId, {
    date: input.date,
    pricesIncludeVat: input.pricesIncludeVat,
    lines: input.lines.map((l) => ({ ...l, prepaymentInvoiceId: null })),
  });
  const data = {
    customerId: customer.id,
    ...customerSnapshot(customer),
    date: input.date,
    validUntil: input.validUntil ?? null,
    currency: input.currency || customer.currency || company.baseCurrency,
    pricesIncludeVat: input.pricesIncludeVat,
    locale: customer.locale,
    yourReference: input.yourReference ?? null,
    notes: input.notes ?? null,
    netTotal: calc.net.toFixed(2),
    vatTotal: calc.vat.toFixed(2),
    total: calc.total.toFixed(2),
  };
  const quoteLines = (quoteId: string) =>
    lineData(rows).map((r) => ({ ...omit(r, "prepaymentInvoiceId", "marginVatAmount"), companyId, quoteId }));
  if (input.id) {
    await tx.quote.update({ where: { id: input.id }, data });
    await tx.quoteLine.deleteMany({ where: { companyId, quoteId: input.id } });
    await tx.quoteLine.createMany({ data: quoteLines(input.id) });
    return input.id;
  }
  const number = await nextDocumentNumber(tx, companyId, "QUOTE", input.date);
  const created = await tx.quote.create({ data: { companyId, number, createdById: userId, ...data } });
  await tx.quoteLine.createMany({ data: quoteLines(created.id) });
  return created.id;
}

/** Pakkumisest arve mustand; pakkumine märgitakse arveks tehtuks. */
export async function quoteToInvoice(tx: Tx, companyId: string, userId: string | null, quoteId: string, date: Date) {
  const quote = await tx.quote.findFirst({
    where: { companyId, id: quoteId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quote) throw new SalesError("quoteNotFound");
  if (quote.status === "INVOICED") throw new SalesError("quoteInvoiced");
  const invoiceId = await saveInvoiceDraft(tx, companyId, userId, {
    type: "INVOICE",
    customerId: quote.customerId,
    date,
    currency: quote.currency,
    pricesIncludeVat: quote.pricesIncludeVat,
    yourReference: quote.yourReference,
    quoteId: quote.id,
    lines: quote.lines.map((l) => ({
      itemId: l.itemId,
      code: l.code,
      description: l.description,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
      vatRateId: l.vatRateId,
      accountId: l.accountId,
      departmentId: l.departmentId,
      dimensionValueIds: l.dimensionValueIds,
      unitCost: l.unitCost?.toString() ?? null,
    })),
  });
  const res = await tx.quote.updateMany({
    where: { companyId, id: quoteId, status: { not: "INVOICED" } },
    data: { status: "INVOICED", invoiceId },
  });
  if (res.count !== 1) throw new SalesError("quoteInvoiced");
  return invoiceId;
}

