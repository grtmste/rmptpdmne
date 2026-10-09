import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { toISODate } from "@/lib/accounting/dates";
import { toBase } from "@/lib/sales/calc";

/**
 * Müügi- ja ostuaruanne ning analüüs (kinnitatud arved perioodis, eurodes).
 * Rühmitus: arve, partner, artikkel/konto või kuu. Kreeditarved on miinusega.
 */

type Tx = Prisma.TransactionClient;

export type SalesGroup = "invoice" | "customer" | "item" | "month";
export type PurchaseGroup = "invoice" | "supplier" | "account" | "month";

export type DocReportRow = {
  key: string;
  label: string;
  sub: string | null;
  /** Arve rühmituses dokumendi id (link eelvaatesse) */
  documentId: string | null;
  count: number;
  quantity: Decimal | null;
  net: Decimal;
  vat: Decimal;
  total: Decimal;
};

type Bucket = DocReportRow & { docs: Set<string> };

function collect() {
  const map = new Map<string, Bucket>();
  return {
    add(key: string, init: Omit<DocReportRow, "count" | "net" | "vat" | "total" | "quantity">, v: { doc: string; net: Decimal; vat: Decimal; quantity?: Decimal }) {
      let b = map.get(key);
      if (!b) {
        b = { ...init, key, count: 0, quantity: null, net: dec(0), vat: dec(0), total: dec(0), docs: new Set() };
        map.set(key, b);
      }
      b.docs.add(v.doc);
      b.count = b.docs.size;
      b.net = b.net.plus(v.net);
      b.vat = b.vat.plus(v.vat);
      b.total = b.net.plus(b.vat);
      if (v.quantity) b.quantity = (b.quantity ?? dec(0)).plus(v.quantity);
    },
    rows(sortByLabel: boolean): DocReportRow[] {
      const rows: DocReportRow[] = [...map.values()].map((b) => ({
        key: b.key,
        label: b.label,
        sub: b.sub,
        documentId: b.documentId,
        count: b.count,
        quantity: b.quantity,
        net: b.net,
        vat: b.vat,
        total: b.total,
      }));
      return sortByLabel ? rows.sort((a, b) => a.label.localeCompare(b.label, "et")) : rows;
    },
  };
}

function totals(rows: DocReportRow[]) {
  return {
    net: rows.reduce((s, r) => s.plus(r.net), dec(0)),
    vat: rows.reduce((s, r) => s.plus(r.vat), dec(0)),
    total: rows.reduce((s, r) => s.plus(r.total), dec(0)),
  };
}

const month = (d: Date) => toISODate(d).slice(0, 7);

export async function salesReport(tx: Tx, companyId: string, opts: { from: Date; to: Date; group: SalesGroup; search?: string }) {
  const needle = opts.search?.trim();
  const invoices = await tx.salesInvoice.findMany({
    where: {
      companyId,
      status: "CONFIRMED",
      date: { gte: opts.from, lte: opts.to },
      ...(needle ? { OR: [{ customerName: { contains: needle, mode: "insensitive" } }, { number: { contains: needle } }] } : {}),
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      type: true,
      date: true,
      customerId: true,
      customerName: true,
      currencyRate: true,
      netTotal: true,
      vatTotal: true,
      ...(opts.group === "item"
        ? { lines: { select: { itemId: true, code: true, description: true, quantity: true, unit: true, netAmount: true, vatAmount: true, marginVatAmount: true } } }
        : {}),
    },
  });
  const c = collect();
  for (const i of invoices) {
    const net = toBase(i.netTotal, i.currencyRate);
    const vat = toBase(i.vatTotal, i.currencyRate);
    if (opts.group === "invoice") {
      c.add(i.id, { key: i.id, label: i.number ?? "", sub: i.customerName, documentId: i.id }, { doc: i.id, net, vat });
    } else if (opts.group === "customer") {
      c.add(i.customerId, { key: i.customerId, label: i.customerName, sub: null, documentId: null }, { doc: i.id, net, vat });
    } else if (opts.group === "month") {
      c.add(month(i.date), { key: month(i.date), label: month(i.date), sub: null, documentId: null }, { doc: i.id, net, vat });
    } else {
      const lines = (i as unknown as { lines: Array<{ itemId: string | null; code: string | null; description: string; quantity: Prisma.Decimal; unit: string | null; netAmount: Prisma.Decimal; vatAmount: Prisma.Decimal; marginVatAmount: Prisma.Decimal }> }).lines;
      for (const l of lines) {
        const key = l.itemId ?? `text:${l.description.toLowerCase()}`;
        c.add(
          key,
          { key, label: l.itemId ? `${l.code ? `${l.code} ` : ""}${l.description}` : l.description, sub: l.unit, documentId: null },
          {
            doc: i.id,
            net: toBase(dec(l.netAmount).minus(dec(l.marginVatAmount)), i.currencyRate),
            vat: toBase(dec(l.vatAmount).plus(dec(l.marginVatAmount)), i.currencyRate),
            quantity: dec(l.quantity),
          },
        );
      }
    }
  }
  const rows = c.rows(opts.group === "customer" || opts.group === "item");
  if (opts.group === "item") rows.sort((a, b) => b.net.comparedTo(a.net));
  return { rows, totals: totals(rows), documentCount: invoices.length };
}

export async function purchaseReport(tx: Tx, companyId: string, opts: { from: Date; to: Date; group: PurchaseGroup; search?: string }) {
  const needle = opts.search?.trim();
  const invoices = await tx.purchaseInvoice.findMany({
    where: {
      companyId,
      status: "CONFIRMED",
      date: { gte: opts.from, lte: opts.to },
      ...(needle
        ? { OR: [{ supplierName: { contains: needle, mode: "insensitive" } }, { number: { contains: needle } }, { invoiceNumber: { contains: needle } }] }
        : {}),
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      invoiceNumber: true,
      date: true,
      supplierId: true,
      supplierName: true,
      currencyRate: true,
      netTotal: true,
      vatTotal: true,
      ...(opts.group === "account" ? { lines: { select: { accountId: true, netAmount: true, vatAmount: true } } } : {}),
    },
  });
  const c = collect();
  let accounts = new Map<string, { code: string; name: string }>();
  if (opts.group === "account") {
    const rows = await tx.glAccount.findMany({ where: { companyId }, select: { id: true, code: true, name: true } });
    accounts = new Map(rows.map((a) => [a.id, a]));
  }
  for (const i of invoices) {
    const net = toBase(i.netTotal, i.currencyRate);
    const vat = toBase(i.vatTotal, i.currencyRate);
    if (opts.group === "invoice") {
      c.add(i.id, { key: i.id, label: i.number ?? "", sub: [i.supplierName, i.invoiceNumber].filter(Boolean).join(" · "), documentId: i.id }, { doc: i.id, net, vat });
    } else if (opts.group === "supplier") {
      const key = i.supplierId ?? i.supplierName;
      c.add(key, { key, label: i.supplierName, sub: null, documentId: null }, { doc: i.id, net, vat });
    } else if (opts.group === "month") {
      c.add(month(i.date), { key: month(i.date), label: month(i.date), sub: null, documentId: null }, { doc: i.id, net, vat });
    } else {
      const lines = (i as unknown as { lines: Array<{ accountId: string; netAmount: Prisma.Decimal; vatAmount: Prisma.Decimal }> }).lines;
      for (const l of lines) {
        const a = accounts.get(l.accountId);
        c.add(l.accountId, { key: l.accountId, label: a ? `${a.code} ${a.name}` : "—", sub: null, documentId: null }, { doc: i.id, net: toBase(l.netAmount, i.currencyRate), vat: toBase(l.vatAmount, i.currencyRate) });
      }
    }
  }
  const rows = c.rows(opts.group !== "invoice" && opts.group !== "month");
  return { rows, totals: totals(rows), documentCount: invoices.length };
}
