import type { Prisma } from "@/generated/prisma/client";
import { resolveVatRate } from "@/lib/accounting/vat";
import { toISODate } from "@/lib/accounting/dates";
import { dec, type DecimalInput } from "@/lib/money";
import { toBase, type VatKindLike } from "@/lib/sales/calc";
import { buildPurchasePosting, calculatePurchase } from "@/lib/purchases/calc";
import { assertPeriodOpen, postJournalEntry } from "./journal";
import { nextDocumentNumber } from "./numbering";
import { checkedWarehouse, exchangeRateFor, roleAccount, SalesError } from "./sales";
import { inventoryRoleAccount, postDocumentMovement } from "./inventory";

type Tx = Prisma.TransactionClient;

/**
 * Ostuarved, ostutellimused ja kuluaruanded. Reeglid nagu müügil: mustandit võib vabalt muuta,
 * kinnitamisel kontrollitakse kõik, antakse number ja tehakse kanne; kinnitatud dokumenti ei muudeta.
 */

export type PurchaseLineInput = {
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

const isBlank = (v: DecimalInput | null | undefined) => v === null || v === undefined || v === "";

type VatInfo = { id: string; code: string; kind: VatKindLike; deductiblePct: { toString(): string }; purchaseAccountId: string | null; salesAccountId: string | null; periods: Array<{ rate: DecimalInput; validFrom: Date; validTo: Date | null }> };

/** Standardmäär kuupäeval: esimene täielikult mahaarvatav maksustatav KM kood (vaikimisi „KM“). */
async function standardPct(tx: Tx, companyId: string, date: Date): Promise<string | null> {
  const rate = await tx.vatRate.findFirst({
    where: { companyId, kind: "TAXABLE", deductiblePct: 100 },
    orderBy: { sortOrder: "asc" },
    include: { periods: true },
  });
  return rate ? (resolveVatRate(rate.periods, date)?.toString() ?? null) : null;
}

/** Ridade kontroll ja summad. Konto: rea oma → artikli kulukonto → vaikimisi (tarnija või ettevõtte). */
async function preparePurchaseLines(
  tx: Tx,
  companyId: string,
  opts: { date: Date; pricesIncludeVat: boolean; lines: PurchaseLineInput[]; defaultAccountId: string | null; requireAccount: boolean },
) {
  const lines = opts.lines.filter((l) => l.description.trim() || l.itemId || !dec(l.unitPrice || 0).isZero());
  const ids = (k: "vatRateId" | "itemId" | "accountId") => [...new Set(lines.map((l) => l[k]).filter(Boolean) as string[])];
  const vatRates = (await tx.vatRate.findMany({ where: { companyId, id: { in: ids("vatRateId") } }, include: { periods: true } })) as VatInfo[];
  const items = await tx.item.findMany({ where: { companyId, id: { in: ids("itemId") } } });
  const accounts = await tx.glAccount.findMany({ where: { companyId, id: { in: ids("accountId") } }, select: { id: true } });
  const vatById = new Map(vatRates.map((v) => [v.id, v]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const accountIds = new Set(accounts.map((a) => a.id));
  const std = await standardPct(tx, companyId, opts.date);
  const inventoryAccountId = items.some((i) => i.trackStock) ? await inventoryRoleAccount(tx, companyId) : null;

  const prepared = lines.map((l, index) => {
    if (l.itemId && !itemById.has(l.itemId)) throw new SalesError("itemNotFound", { index });
    const item = l.itemId ? itemById.get(l.itemId)! : null;
    const description = l.description.trim() || item?.name || "";
    if (!description) throw new SalesError("lineDescription", { index });
    if (l.accountId && !accountIds.has(l.accountId)) throw new SalesError("accountNotFound", { index });
    // Laokauba rida kirjendatakse alati laokontole
    const stockAccount = item?.trackStock ? (item.inventoryAccountId ?? inventoryAccountId) : null;
    const accountId = stockAccount || l.accountId || item?.purchaseAccountId || opts.defaultAccountId || null;
    if (opts.requireAccount && !accountId) throw new SalesError("accountNotFound", { index });
    const vatRateId = l.vatRateId || null;
    let vatPct = "0";
    let vatKind: VatKindLike | null = null;
    let deductiblePct = "100";
    if (vatRateId) {
      const v = vatById.get(vatRateId);
      if (!v) throw new SalesError("vatRateNotFound", { index });
      const pct = resolveVatRate(v.periods, opts.date);
      if (pct === null) throw new SalesError("vatRateNotValid", { index, vat: v.code, date: toISODate(opts.date) });
      vatPct = pct.toFixed(2);
      vatKind = v.kind;
      deductiblePct = v.deductiblePct.toString();
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
      deductiblePct,
      accountId,
      departmentId: l.departmentId || null,
      dimensionValueIds: (l.dimensionValueIds ?? []).filter(Boolean),
    };
  });
  const calc = calculatePurchase(prepared, { pricesIncludeVat: opts.pricesIncludeVat, standardPct: std });
  const rows = prepared.map((p, i) => ({
    ...p,
    netAmount: calc.lines[i]!.net.toFixed(2),
    vatAmount: calc.lines[i]!.vat.toFixed(2),
    reverseVatAmount: calc.lines[i]!.reverseVat.toFixed(2),
    deductibleVat: calc.lines[i]!.deductible.toFixed(2),
  }));
  return { rows, calc, vatById };
}

type PreparedRow = Awaited<ReturnType<typeof preparePurchaseLines>>["rows"][number];

/** Standardmäära koodi KM kontod – varuvariant koodidele, millel kontod puuduvad (nt EL teenus). */
async function fallbackVatAccounts(tx: Tx, companyId: string) {
  const rate = await tx.vatRate.findFirst({
    where: { companyId, kind: "TAXABLE", deductiblePct: 100 },
    orderBy: { sortOrder: "asc" },
    select: { purchaseAccountId: true, salesAccountId: true },
  });
  return { input: rate?.purchaseAccountId ?? null, output: rate?.salesAccountId ?? null };
}

/** KM koodi kontod; pöördmaksustamise koodil puuduvad kontod võetakse standardmäära koodilt. */
async function vatAccountsFor(tx: Tx, companyId: string, rows: Array<{ vatRateId: string | null }>, vatById: Map<string, VatInfo>) {
  const fallback = await fallbackVatAccounts(tx, companyId);
  const map = new Map<string, { input: string | null; output: string | null }>();
  for (const r of rows) {
    if (!r.vatRateId) continue;
    const v = vatById.get(r.vatRateId)!;
    const reverse = v.kind === "EU_SERVICES" || v.kind === "ZERO_EU_GOODS" || v.kind === "REVERSE_CHARGE";
    map.set(v.id, {
      input: v.purchaseAccountId ?? (reverse ? fallback.input : null),
      output: v.salesAccountId ?? (reverse ? fallback.output : null),
    });
  }
  return map;
}

/** Kontrollib, et KM kontod on olemas, enne kui kanne koostatakse (selge veateade). */
function assertVatAccounts(
  rows: Array<{ vatRateId: string | null; deductibleVat: string; reverseVatAmount: string }>,
  vatById: Map<string, VatInfo>,
  accounts: Map<string, { input: string | null; output: string | null }>,
) {
  for (const r of rows) {
    if (!r.vatRateId) continue;
    const v = vatById.get(r.vatRateId)!;
    const a = accounts.get(v.id);
    if (!dec(r.deductibleVat).isZero() && !a?.input) throw new SalesError("vatAccountMissing", { vat: v.code });
    if (!dec(r.reverseVatAmount).isZero() && !a?.output) throw new SalesError("vatAccountMissing", { vat: v.code });
  }
}

const postingLines = (rows: PreparedRow[]) =>
  rows.map((r) => ({
    accountId: r.accountId!,
    departmentId: r.departmentId,
    dimensionValueIds: r.dimensionValueIds,
    vatRateId: r.vatRateId,
    net: r.netAmount,
    vat: r.vatAmount,
    reverseVat: r.reverseVatAmount,
    deductible: r.deductibleVat,
  }));

const journalLines = (posting: ReturnType<typeof buildPurchasePosting>) =>
  posting.map((p) => ({
    accountId: p.accountId,
    debit: p.debit.toFixed(2),
    credit: p.credit.toFixed(2),
    departmentId: p.departmentId ?? null,
    vatRateId: p.vatRateId ?? null,
    vatAmount: p.vatAmount ? p.vatAmount.toFixed(2) : null,
    dimensionValueIds: p.dimensionValueIds ?? [],
  }));

function lineRows(rows: PreparedRow[]) {
  return rows.map((r, sortOrder) => {
    const { vatKind: _k, deductiblePct: _d, ...rest } = r;
    void _k;
    void _d;
    return { ...rest, sortOrder };
  });
}

// ---------------------------------------------------------------------------
// Ostuarved
// ---------------------------------------------------------------------------

export type PurchaseInvoiceInput = {
  id?: string;
  isCredit?: boolean;
  supplierId?: string | null;
  invoiceNumber?: string | null;
  date: Date;
  dueDate?: Date | null;
  referenceNumber?: string | null;
  currency?: string;
  currencyRate?: DecimalInput | null;
  pricesIncludeVat: boolean;
  notes?: string | null;
  creditOfId?: string | null;
  purchaseOrderId?: string | null;
  /** Ladu laokaupade vastuvõtmiseks (null = vaikimisi ladu) */
  warehouseId?: string | null;
  source?: "MANUAL" | "UPLOAD" | "ORDER";
  lines: PurchaseLineInput[];
};

async function loadSupplier(tx: Tx, companyId: string, supplierId: string) {
  const s = await tx.supplier.findFirst({ where: { companyId, id: supplierId } });
  if (!s) throw new SalesError("supplierNotFound");
  return s;
}

async function defaultPurchaseAccount(tx: Tx, companyId: string, supplier: { defaultAccountId: string | null } | null) {
  if (supplier?.defaultAccountId) return supplier.defaultAccountId;
  const a = await tx.glAccount.findFirst({ where: { companyId, role: "DEFAULT_PURCHASE" }, select: { id: true } });
  return a?.id ?? null;
}

export async function savePurchaseDraft(tx: Tx, companyId: string, userId: string | null, input: PurchaseInvoiceInput) {
  let existing: { id: string; isCredit: boolean; creditOfId: string | null; source: "MANUAL" | "UPLOAD" | "ORDER" } | null = null;
  if (input.id) {
    const r = await tx.purchaseInvoice.findFirst({
      where: { companyId, id: input.id },
      select: { id: true, status: true, isCredit: true, creditOfId: true, source: true },
    });
    if (!r) throw new SalesError("invoiceNotFound");
    if (r.status !== "DRAFT") throw new SalesError("notDraft");
    existing = r;
  }
  const supplier = input.supplierId ? await loadSupplier(tx, companyId, input.supplierId) : null;
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { paymentTermDays: true, baseCurrency: true } });
  const creditOfId = existing ? existing.creditOfId : (input.creditOfId ?? null);
  if (creditOfId) {
    const original = await tx.purchaseInvoice.findFirst({ where: { companyId, id: creditOfId, status: "CONFIRMED" }, select: { id: true } });
    if (!original) throw new SalesError("cannotCredit");
  }
  const { rows, calc } = await preparePurchaseLines(tx, companyId, {
    date: input.date,
    pricesIncludeVat: input.pricesIncludeVat,
    lines: input.lines,
    defaultAccountId: await defaultPurchaseAccount(tx, companyId, supplier),
    requireAccount: true,
  });
  const currency = input.currency || supplier?.currency || company.baseCurrency;
  const currencyRate = isBlank(input.currencyRate) ? await exchangeRateFor(tx, currency, input.date) : dec(input.currencyRate!).toString();
  const days = supplier?.paymentTermDays ?? company.paymentTermDays;
  const due = new Date(input.date.getTime());
  due.setUTCDate(due.getUTCDate() + days);
  const data = {
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? "",
    supplierRegCode: supplier?.regCode ?? null,
    supplierVatNumber: supplier?.vatNumber ?? null,
    bankAccount: supplier?.bankAccount ?? null,
    invoiceNumber: input.invoiceNumber?.trim() || null,
    date: input.date,
    dueDate: input.dueDate ?? due,
    referenceNumber: input.referenceNumber?.trim() || supplier?.referenceNumber || null,
    currency,
    currencyRate,
    pricesIncludeVat: input.pricesIncludeVat,
    notes: input.notes ?? null,
    warehouseId: await checkedWarehouse(tx, companyId, input.warehouseId),
    netTotal: calc.net.toFixed(2),
    vatTotal: calc.vat.toFixed(2),
    total: calc.total.toFixed(2),
    totalBase: toBase(calc.total, currencyRate).toFixed(2),
  };
  const lineData = (invoiceId: string) => lineRows(rows).map((r) => ({ ...r, accountId: r.accountId!, companyId, invoiceId }));
  if (existing) {
    await tx.purchaseInvoice.update({ where: { id: existing.id }, data });
    await tx.purchaseInvoiceLine.deleteMany({ where: { companyId, invoiceId: existing.id } });
    await tx.purchaseInvoiceLine.createMany({ data: lineData(existing.id) });
    return existing.id;
  }
  const created = await tx.purchaseInvoice.create({
    data: {
      companyId,
      status: "DRAFT",
      isCredit: input.isCredit ?? false,
      source: input.source ?? "MANUAL",
      creditOfId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      createdById: userId,
      ...data,
    },
  });
  await tx.purchaseInvoiceLine.createMany({ data: lineData(created.id) });
  return created.id;
}

export async function confirmPurchase(tx: Tx, companyId: string, userId: string | null, id: string) {
  const invoice = await tx.purchaseInvoice.findFirst({ where: { companyId, id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!invoice) throw new SalesError("invoiceNotFound");
  if (invoice.status !== "DRAFT") throw new SalesError("notDraft");
  if (!invoice.supplierId) throw new SalesError("supplierRequired");
  if (!invoice.invoiceNumber) throw new SalesError("invoiceNumberRequired");
  if (invoice.lines.length === 0) throw new SalesError("noLines");
  await assertPeriodOpen(tx, companyId, invoice.date, "PURCHASE_INVOICE");
  const duplicate = await tx.purchaseInvoice.findFirst({
    where: { companyId, supplierId: invoice.supplierId, invoiceNumber: invoice.invoiceNumber, status: "CONFIRMED", isCredit: invoice.isCredit },
    select: { number: true },
  });
  if (duplicate) throw new SalesError("duplicateInvoiceNumber", { number: duplicate.number ?? "" });

  const supplier = await loadSupplier(tx, companyId, invoice.supplierId);
  const { rows, calc, vatById } = await preparePurchaseLines(tx, companyId, {
    date: invoice.date,
    pricesIncludeVat: invoice.pricesIncludeVat,
    lines: invoice.lines.map((l) => ({
      ...l,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
    })),
    defaultAccountId: await defaultPurchaseAccount(tx, companyId, supplier),
    requireAccount: true,
  });
  if (invoice.isCredit && !calc.total.isNegative()) throw new SalesError("creditNotNegative");
  const vatAccounts = await vatAccountsFor(tx, companyId, rows, vatById);
  assertVatAccounts(rows, vatById, vatAccounts);

  const number = await nextDocumentNumber(tx, companyId, "PURCHASE_INVOICE", invoice.date);
  const posting = buildPurchasePosting({
    payableAccountId: await roleAccount(tx, companyId, "PAYABLES"),
    vatAccounts,
    currencyRate: invoice.currencyRate.toString(),
    lines: postingLines(rows),
  });
  let journalEntryId: string | null = null;
  if (posting.length > 0) {
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: invoice.date,
      source: "PURCHASE_INVOICE",
      sourceId: invoice.id,
      number,
      description: `${supplier.name} ${invoice.invoiceNumber}`,
      lines: journalLines(posting),
    });
    journalEntryId = entry.id;
  }
  const res = await tx.purchaseInvoice.updateMany({
    where: { companyId, id, status: "DRAFT" },
    data: {
      status: "CONFIRMED",
      number,
      journalEntryId,
      confirmedAt: new Date(),
      confirmedById: userId,
      supplierName: supplier.name,
      netTotal: calc.net.toFixed(2),
      vatTotal: calc.vat.toFixed(2),
      total: calc.total.toFixed(2),
      totalBase: toBase(calc.total, invoice.currencyRate.toString()).toFixed(2),
    },
  });
  if (res.count !== 1) throw new SalesError("notDraft");
  await tx.purchaseInvoiceLine.deleteMany({ where: { companyId, invoiceId: id } });
  await tx.purchaseInvoiceLine.createMany({ data: lineRows(rows).map((r) => ({ ...r, accountId: r.accountId!, companyId, invoiceId: id })) });
  // Laokaubad: sissetulek lattu arve summaga (kreeditarvel tagastus tarnijale omahinnaga)
  const rate = invoice.currencyRate.toString();
  await postDocumentMovement(tx, companyId, userId, {
    type: "PURCHASE",
    date: invoice.date,
    warehouseId: invoice.warehouseId,
    number,
    description: `${supplier.name} ${invoice.invoiceNumber}`,
    purchaseInvoiceId: id,
    lines: rows
      .filter((r) => r.itemId)
      .map((r) => {
        const booked = toBase(dec(r.netAmount).plus(dec(r.vatAmount)).plus(dec(r.reverseVatAmount)).minus(dec(r.deductibleVat)), rate);
        return { itemId: r.itemId!, quantity: r.quantity, value: dec(r.quantity).isNegative() ? null : booked, bookedCost: booked };
      }),
  });
  return { id, number };
}

export async function deletePurchaseDraft(tx: Tx, companyId: string, id: string) {
  const invoice = await tx.purchaseInvoice.findFirst({ where: { companyId, id }, select: { status: true, purchaseOrderId: true } });
  if (!invoice) throw new SalesError("invoiceNotFound");
  if (invoice.status !== "DRAFT") throw new SalesError("notDraft");
  await tx.attachment.deleteMany({ where: { companyId, documentType: "PurchaseInvoice", documentId: id } });
  await tx.purchaseInvoice.delete({ where: { id } });
  if (invoice.purchaseOrderId) {
    await tx.purchaseOrder.updateMany({ where: { companyId, id: invoice.purchaseOrderId, invoiceId: id }, data: { status: "RECEIVED", invoiceId: null } });
  }
}

const purchaseLineInput = (l: Prisma.PurchaseInvoiceLineGetPayload<object>, quantity?: string): PurchaseLineInput => ({
  itemId: l.itemId,
  code: l.code,
  description: l.description,
  quantity: quantity ?? l.quantity.toString(),
  unit: l.unit,
  unitPrice: l.unitPrice.toString(),
  discountPct: l.discountPct.toString(),
  vatRateId: l.vatRateId,
  accountId: l.accountId,
  departmentId: l.departmentId,
  dimensionValueIds: l.dimensionValueIds,
});

/** Tarnija kreeditarve kinnitatud ostuarvest (read negatiivse kogusega). */
export async function createPurchaseCredit(tx: Tx, companyId: string, userId: string | null, originalId: string, date: Date) {
  const original = await tx.purchaseInvoice.findFirst({ where: { companyId, id: originalId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!original) throw new SalesError("invoiceNotFound");
  if (original.status !== "CONFIRMED" || original.isCredit) throw new SalesError("cannotCredit");
  return savePurchaseDraft(tx, companyId, userId, {
    isCredit: true,
    supplierId: original.supplierId,
    date,
    dueDate: date,
    currency: original.currency,
    currencyRate: original.currencyRate.toString(),
    pricesIncludeVat: original.pricesIncludeVat,
    warehouseId: original.warehouseId,
    creditOfId: original.id,
    lines: original.lines.map((l) => purchaseLineInput(l, dec(l.quantity).negated().toString())),
  });
}

/** Üleslaaditud failist tühi mustand (kinnitamata ostuarvete kaust). */
export async function createUploadDraft(tx: Tx, companyId: string, userId: string | null, date: Date) {
  return savePurchaseDraft(tx, companyId, userId, { date, pricesIncludeVat: false, source: "UPLOAD", lines: [] });
}

// ---------------------------------------------------------------------------
// Ostutellimused
// ---------------------------------------------------------------------------

export type PurchaseOrderInput = {
  id?: string;
  supplierId: string;
  date: Date;
  expectedDate?: Date | null;
  currency?: string;
  pricesIncludeVat: boolean;
  notes?: string | null;
  lines: PurchaseLineInput[];
};

export async function savePurchaseOrder(tx: Tx, companyId: string, userId: string | null, input: PurchaseOrderInput) {
  const supplier = await loadSupplier(tx, companyId, input.supplierId);
  if (input.id) {
    const existing = await tx.purchaseOrder.findFirst({ where: { companyId, id: input.id }, select: { status: true } });
    if (!existing) throw new SalesError("orderNotFound");
    if (existing.status === "INVOICED") throw new SalesError("orderInvoiced");
  }
  const { rows, calc } = await preparePurchaseLines(tx, companyId, {
    date: input.date,
    pricesIncludeVat: input.pricesIncludeVat,
    lines: input.lines,
    defaultAccountId: null,
    requireAccount: false,
  });
  const data = {
    supplierId: supplier.id,
    supplierName: supplier.name,
    date: input.date,
    expectedDate: input.expectedDate ?? null,
    currency: input.currency || supplier.currency,
    pricesIncludeVat: input.pricesIncludeVat,
    notes: input.notes ?? null,
    netTotal: calc.net.toFixed(2),
    vatTotal: calc.vat.toFixed(2),
    total: calc.total.toFixed(2),
  };
  const lineData = (orderId: string) =>
    lineRows(rows).map((r) => {
      const { reverseVatAmount: _r, deductibleVat: _d, ...rest } = r;
      void _r;
      void _d;
      return { ...rest, companyId, orderId };
    });
  if (input.id) {
    await tx.purchaseOrder.update({ where: { id: input.id }, data });
    await tx.purchaseOrderLine.deleteMany({ where: { companyId, orderId: input.id } });
    await tx.purchaseOrderLine.createMany({ data: lineData(input.id) });
    return input.id;
  }
  const number = await nextDocumentNumber(tx, companyId, "PURCHASE_ORDER", input.date);
  const created = await tx.purchaseOrder.create({ data: { companyId, number, createdById: userId, ...data } });
  await tx.purchaseOrderLine.createMany({ data: lineData(created.id) });
  return created.id;
}

/** Tellimusest ostuarve mustand (tarnija arve number lisatakse arve saabumisel). */
export async function orderToPurchaseInvoice(tx: Tx, companyId: string, userId: string | null, orderId: string, date: Date) {
  const order = await tx.purchaseOrder.findFirst({ where: { companyId, id: orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!order) throw new SalesError("orderNotFound");
  if (order.status === "INVOICED") throw new SalesError("orderInvoiced");
  const invoiceId = await savePurchaseDraft(tx, companyId, userId, {
    supplierId: order.supplierId,
    date,
    currency: order.currency,
    pricesIncludeVat: order.pricesIncludeVat,
    notes: order.notes,
    purchaseOrderId: order.id,
    source: "ORDER",
    lines: order.lines.map((l) => ({
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
    })),
  });
  const res = await tx.purchaseOrder.updateMany({ where: { companyId, id: orderId, status: { not: "INVOICED" } }, data: { status: "INVOICED", invoiceId } });
  if (res.count !== 1) throw new SalesError("orderInvoiced");
  return invoiceId;
}

// ---------------------------------------------------------------------------
// Kuluaruanded
// ---------------------------------------------------------------------------

export type ExpenseLineInput = {
  date: Date;
  vendor?: string | null;
  documentNumber?: string | null;
  description: string;
  accountId?: string | null;
  vatRateId?: string | null;
  grossAmount: DecimalInput;
  departmentId?: string | null;
  dimensionValueIds?: string[];
};

export type ExpenseReportInput = {
  id?: string;
  employeeId: string;
  date: Date;
  description?: string | null;
  lines: ExpenseLineInput[];
};

async function prepareExpenseLines(tx: Tx, companyId: string, lines: ExpenseLineInput[]) {
  const defaultAccountId = await defaultPurchaseAccount(tx, companyId, null);
  // Iga tšekk on eraldi dokument: KM eraldatakse brutosummast tšeki kuupäeva määraga
  const out = [];
  for (const [index, l] of lines.entries()) {
    const { rows } = await preparePurchaseLines(tx, companyId, {
      date: l.date,
      pricesIncludeVat: true,
      lines: [{ description: l.description, quantity: "1", unitPrice: l.grossAmount, vatRateId: l.vatRateId, accountId: l.accountId, departmentId: l.departmentId, dimensionValueIds: l.dimensionValueIds }],
      defaultAccountId,
      requireAccount: true,
    }).catch((e) => {
      if (e instanceof SalesError && typeof e.meta.index === "number") e.meta.index = index;
      throw e;
    });
    const r = rows[0];
    if (!r) throw new SalesError("lineDescription", { index });
    out.push({ input: l, row: r });
  }
  return out;
}

export async function saveExpenseReport(tx: Tx, companyId: string, userId: string | null, input: ExpenseReportInput) {
  const employee = await tx.employee.findFirst({ where: { companyId, id: input.employeeId } });
  if (!employee) throw new SalesError("employeeNotFound");
  if (input.id) {
    const existing = await tx.expenseReport.findFirst({ where: { companyId, id: input.id }, select: { status: true } });
    if (!existing) throw new SalesError("reportNotFound");
    if (existing.status !== "DRAFT") throw new SalesError("notDraft");
  }
  const prepared = await prepareExpenseLines(
    tx,
    companyId,
    input.lines.filter((l) => l.description.trim() || !dec(l.grossAmount || 0).isZero()),
  );
  const net = prepared.reduce((s, p) => s.plus(p.row.netAmount), dec(0));
  const vat = prepared.reduce((s, p) => s.plus(p.row.vatAmount), dec(0));
  const data = {
    employeeId: employee.id,
    employeeName: employee.name,
    date: input.date,
    description: input.description ?? null,
    netTotal: net.toFixed(2),
    vatTotal: vat.toFixed(2),
    total: net.plus(vat).toFixed(2),
  };
  const lineData = (reportId: string) =>
    prepared.map(({ input: l, row }, sortOrder) => ({
      companyId,
      reportId,
      date: l.date,
      vendor: l.vendor?.trim() || null,
      documentNumber: l.documentNumber?.trim() || null,
      description: row.description,
      accountId: row.accountId!,
      vatRateId: row.vatRateId,
      vatPct: row.vatPct,
      grossAmount: dec(l.grossAmount).toFixed(2),
      netAmount: row.netAmount,
      vatAmount: row.vatAmount,
      deductibleVat: row.deductibleVat,
      departmentId: row.departmentId,
      dimensionValueIds: row.dimensionValueIds,
      sortOrder,
    }));
  if (input.id) {
    await tx.expenseReport.update({ where: { id: input.id }, data });
    await tx.expenseReportLine.deleteMany({ where: { companyId, reportId: input.id } });
    await tx.expenseReportLine.createMany({ data: lineData(input.id) });
    return input.id;
  }
  const created = await tx.expenseReport.create({ data: { companyId, status: "DRAFT", createdById: userId, ...data } });
  await tx.expenseReportLine.createMany({ data: lineData(created.id) });
  return created.id;
}

/** Kuluaruande kinnitamine: D kulud / D sisend-KM / K võlad aruandvatele isikutele. */
export async function confirmExpenseReport(tx: Tx, companyId: string, userId: string | null, id: string) {
  const report = await tx.expenseReport.findFirst({ where: { companyId, id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!report) throw new SalesError("reportNotFound");
  if (report.status !== "DRAFT") throw new SalesError("notDraft");
  if (report.lines.length === 0) throw new SalesError("noLines");
  await assertPeriodOpen(tx, companyId, report.date, "EXPENSE_REPORT");
  const prepared = await prepareExpenseLines(
    tx,
    companyId,
    report.lines.map((l) => ({ ...l, grossAmount: l.grossAmount.toString() })),
  );
  const rows = prepared.map((p) => p.row);
  const vatRates = (await tx.vatRate.findMany({
    where: { companyId, id: { in: rows.map((r) => r.vatRateId).filter((x): x is string => Boolean(x)) } },
    include: { periods: true },
  })) as VatInfo[];
  const vatById = new Map(vatRates.map((v) => [v.id, v]));
  const vatAccounts = await vatAccountsFor(tx, companyId, rows, vatById);
  assertVatAccounts(rows, vatById, vatAccounts);
  const number = await nextDocumentNumber(tx, companyId, "EXPENSE_REPORT", report.date);
  const posting = buildPurchasePosting({
    payableAccountId: await roleAccount(tx, companyId, "EMPLOYEE_PAYABLES"),
    vatAccounts,
    currencyRate: "1",
    lines: postingLines(rows),
  });
  const entry = await postJournalEntry(tx, companyId, userId, {
    date: report.date,
    source: "EXPENSE_REPORT",
    sourceId: report.id,
    number,
    description: `${report.employeeName}${report.description ? ` – ${report.description}` : ""}`,
    lines: journalLines(posting),
  });
  const res = await tx.expenseReport.updateMany({
    where: { companyId, id, status: "DRAFT" },
    data: { status: "CONFIRMED", number, journalEntryId: entry.id, confirmedAt: new Date(), confirmedById: userId },
  });
  if (res.count !== 1) throw new SalesError("notDraft");
  return { id, number };
}

export async function deleteExpenseDraft(tx: Tx, companyId: string, id: string) {
  const report = await tx.expenseReport.findFirst({ where: { companyId, id }, select: { status: true } });
  if (!report) throw new SalesError("reportNotFound");
  if (report.status !== "DRAFT") throw new SalesError("notDraft");
  await tx.attachment.deleteMany({ where: { companyId, documentType: "ExpenseReport", documentId: id } });
  await tx.expenseReport.delete({ where: { id } });
}
