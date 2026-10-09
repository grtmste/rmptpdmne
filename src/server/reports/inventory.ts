import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec, roundMoney } from "@/lib/money";
import { toBase } from "@/lib/sales/calc";
import { POSTED } from "@/server/services/journal";

/**
 * Laoaruanded. Omahind arvestatakse artikli kaupa üle ladude; lao väärtus on selle lao liikumiste
 * väärtuste summa (ümberpaigutus viib kaasa lähtelao keskmise väärtuse). Kõigi ladude kokkuvõte
 * võrdub alati pearaamatu laokonto saldoga. Arvestatakse ainult kinnitatud liikumisi.
 */

type Tx = Prisma.TransactionClient;

type LineRow = {
  id: string;
  itemId: string;
  quantity: Decimal;
  totalCost: Decimal;
  movement: { id: string; type: string; number: string | null; date: Date; warehouseId: string; toWarehouseId: string | null; description: string | null; salesInvoiceId: string | null; purchaseInvoiceId: string | null; confirmedAt: Date | null };
};

async function lines(tx: Tx, companyId: string, opts: { from?: Date; until?: Date; itemId?: string }): Promise<LineRow[]> {
  const rows = await tx.stockMovementLine.findMany({
    where: {
      companyId,
      ...(opts.itemId ? { itemId: opts.itemId } : {}),
      movement: { status: "CONFIRMED", ...(opts.from || opts.until ? { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.until ? { lte: opts.until } : {}) } } : {}) },
    },
    select: {
      id: true,
      itemId: true,
      quantity: true,
      totalCost: true,
      sortOrder: true,
      movement: {
        select: { id: true, type: true, number: true, date: true, warehouseId: true, toWarehouseId: true, description: true, salesInvoiceId: true, purchaseInvoiceId: true, confirmedAt: true },
      },
    },
  });
  return rows
    .map((r) => ({ ...r, quantity: dec(r.quantity), totalCost: dec(r.totalCost) }))
    .sort(
      (a, b) =>
        a.movement.date.getTime() - b.movement.date.getTime() ||
        (a.quantity.isNegative() ? 1 : 0) - (b.quantity.isNegative() ? 1 : 0) ||
        (a.movement.confirmedAt?.getTime() ?? 0) - (b.movement.confirmedAt?.getTime() ?? 0) ||
        a.sortOrder - b.sortOrder,
    );
}

type Delta = { warehouseId: string; quantity: Decimal; value: Decimal };

/**
 * Käib read läbi ja annab iga rea mõju ladudele. Ümberpaigutus viib kaasa lähtelao keskmise
 * väärtuse; kokku (ilma laota) on ümberpaigutuse mõju null.
 */
function walk(all: LineRow[]) {
  const state = new Map<string, { quantity: Decimal; value: Decimal }>();
  return all.map((l) => {
    const deltas: Delta[] = [];
    if (l.movement.type === "TRANSFER") {
      const from = state.get(`${l.itemId}|${l.movement.warehouseId}`) ?? { quantity: dec(0), value: dec(0) };
      const v = from.quantity.isZero() ? dec(0) : from.quantity.equals(l.quantity) ? from.value : roundMoney(from.value.times(l.quantity).div(from.quantity));
      deltas.push({ warehouseId: l.movement.warehouseId, quantity: l.quantity.negated(), value: v.negated() });
      deltas.push({ warehouseId: l.movement.toWarehouseId!, quantity: l.quantity, value: v });
    } else {
      deltas.push({ warehouseId: l.movement.warehouseId, quantity: l.quantity, value: l.totalCost });
    }
    for (const d of deltas) {
      const key = `${l.itemId}|${d.warehouseId}`;
      const s = state.get(key) ?? { quantity: dec(0), value: dec(0) };
      state.set(key, { quantity: s.quantity.plus(d.quantity), value: s.value.plus(d.value) });
    }
    return { line: l, deltas };
  });
}

/** Rea mõju valitud laole (või kõigile ladudele kokku). */
function effect(deltas: Delta[], warehouseId: string | null) {
  const list = warehouseId ? deltas.filter((d) => d.warehouseId === warehouseId) : deltas;
  return { quantity: list.reduce((s, d) => s.plus(d.quantity), dec(0)), value: list.reduce((s, d) => s.plus(d.value), dec(0)) };
}

async function stockItems(tx: Tx, companyId: string) {
  return tx.item.findMany({
    where: { companyId, trackStock: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, unit: true, inventoryAccountId: true, groupId: true },
  });
}

export type BalanceRow = { itemId: string; code: string; name: string; unit: string | null; quantity: Decimal; value: Decimal; unitCost: Decimal; byWarehouse: Record<string, string> };

/** Laoseis kuupäeva seisuga (k.a). */
export async function stockBalance(tx: Tx, companyId: string, opts: { date: Date; warehouseId?: string | null; includeZero?: boolean }) {
  const [items, all] = await Promise.all([stockItems(tx, companyId), lines(tx, companyId, { until: opts.date })]);
  const w = opts.warehouseId ?? null;
  const totals = new Map<string, { quantity: Decimal; value: Decimal; byWarehouse: Map<string, Decimal> }>();
  for (const { line, deltas } of walk(all)) {
    const t = totals.get(line.itemId) ?? { quantity: dec(0), value: dec(0), byWarehouse: new Map<string, Decimal>() };
    const e = effect(deltas, w);
    t.quantity = t.quantity.plus(e.quantity);
    t.value = t.value.plus(e.value);
    for (const d of deltas) t.byWarehouse.set(d.warehouseId, (t.byWarehouse.get(d.warehouseId) ?? dec(0)).plus(d.quantity));
    totals.set(line.itemId, t);
  }
  const rows: BalanceRow[] = [];
  for (const i of items) {
    const t = totals.get(i.id) ?? { quantity: dec(0), value: dec(0), byWarehouse: new Map<string, Decimal>() };
    if (!opts.includeZero && t.quantity.isZero() && t.value.isZero()) continue;
    rows.push({
      itemId: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      quantity: t.quantity,
      value: t.value,
      unitCost: t.quantity.isZero() ? dec(0) : t.value.div(t.quantity),
      byWarehouse: Object.fromEntries([...t.byWarehouse].filter(([, q]) => !q.isZero()).map(([wh, q]) => [wh, q.toString()])),
    });
  }
  return { rows, total: rows.reduce((s, r) => s.plus(r.value), dec(0)) };
}

/** Lao seisu kontroll: laoseisu väärtus laokontode kaupa võrreldes pearaamatu saldoga. */
export async function stockCheck(tx: Tx, companyId: string, date: Date) {
  const [items, roleAccount, all] = await Promise.all([
    stockItems(tx, companyId),
    tx.glAccount.findFirst({ where: { companyId, role: "INVENTORY" }, select: { id: true } }),
    lines(tx, companyId, { until: date }),
  ]);
  const accountOf = new Map(items.map((i) => [i.id, i.inventoryAccountId ?? roleAccount?.id ?? null]));
  const stock = new Map<string, Decimal>();
  for (const l of all) {
    const a = accountOf.get(l.itemId);
    if (!a || l.movement.type === "TRANSFER") continue;
    stock.set(a, (stock.get(a) ?? dec(0)).plus(l.totalCost));
  }
  const accountIds = [...new Set([...stock.keys(), ...(roleAccount ? [roleAccount.id] : [])])];
  const [accounts, gl] = await Promise.all([
    tx.glAccount.findMany({ where: { companyId, id: { in: accountIds } }, select: { id: true, code: true, name: true } }),
    tx.journalLine.groupBy({ by: ["accountId"], where: { companyId, accountId: { in: accountIds }, entry: { ...POSTED, date: { lte: date } } }, _sum: { debit: true, credit: true } }),
  ]);
  const glBy = new Map(gl.map((g) => [g.accountId, dec(g._sum.debit ?? 0).minus(dec(g._sum.credit ?? 0))]));
  return accounts
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => {
      const s = stock.get(a.id) ?? dec(0);
      const g = glBy.get(a.id) ?? dec(0);
      return { accountId: a.id, code: a.code, name: a.name, stock: s, ledger: g, difference: g.minus(s) };
    });
}

export type ItemMovementRow = {
  id: string;
  movementId: string;
  type: string;
  number: string | null;
  date: Date;
  description: string | null;
  warehouseId: string;
  toWarehouseId: string | null;
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
  quantity: Decimal;
  value: Decimal;
  balanceQty: Decimal;
  balanceValue: Decimal;
};

/** Kauba liikumine: algseis, liikumised jooksva seisuga ja lõppseis. */
export async function itemMovement(tx: Tx, companyId: string, opts: { itemId: string; from: Date; to: Date; warehouseId?: string | null }) {
  const all = await lines(tx, companyId, { until: opts.to, itemId: opts.itemId });
  const w = opts.warehouseId ?? null;
  let qty = dec(0);
  let value = dec(0);
  let opening = { quantity: dec(0), value: dec(0) };
  const rows: ItemMovementRow[] = [];
  for (const { line: l, deltas } of walk(all)) {
    const { quantity: q, value: v } = effect(deltas, w);
    qty = qty.plus(q);
    value = value.plus(v);
    if (l.movement.date < opts.from) {
      opening = { quantity: qty, value };
      continue;
    }
    if (q.isZero() && v.isZero()) continue;
    rows.push({
      id: l.id,
      movementId: l.movement.id,
      type: l.movement.type,
      number: l.movement.number,
      date: l.movement.date,
      description: l.movement.description,
      warehouseId: l.movement.warehouseId,
      toWarehouseId: l.movement.toWarehouseId,
      salesInvoiceId: l.movement.salesInvoiceId,
      purchaseInvoiceId: l.movement.purchaseInvoiceId,
      quantity: q,
      value: v,
      balanceQty: qty,
      balanceValue: value,
    });
  }
  return { opening, rows, closing: { quantity: qty, value } };
}

export type TurnoverRow = {
  itemId: string;
  code: string;
  name: string;
  unit: string | null;
  openingQty: Decimal;
  openingValue: Decimal;
  inQty: Decimal;
  inValue: Decimal;
  outQty: Decimal;
  outValue: Decimal;
  closingQty: Decimal;
  closingValue: Decimal;
};

/** Kaupade käibeandmik: algseis, sissetulek, väljaminek ja lõppseis artiklite kaupa (väärtus kõigi ladude kohta). */
export async function stockTurnover(tx: Tx, companyId: string, opts: { from: Date; to: Date; warehouseId?: string | null }) {
  const [items, all] = await Promise.all([stockItems(tx, companyId), lines(tx, companyId, { until: opts.to })]);
  const w = opts.warehouseId ?? null;
  const zero = () => ({ openingQty: dec(0), openingValue: dec(0), inQty: dec(0), inValue: dec(0), outQty: dec(0), outValue: dec(0) });
  const acc = new Map<string, ReturnType<typeof zero>>();
  for (const { line: l, deltas } of walk(all)) {
    const a = acc.get(l.itemId) ?? zero();
    const { quantity: q, value: v } = effect(deltas, w);
    if (q.isZero() && v.isZero()) continue;
    if (l.movement.date < opts.from) {
      a.openingQty = a.openingQty.plus(q);
      a.openingValue = a.openingValue.plus(v);
    } else if (q.isNegative() || (q.isZero() && v.isNegative())) {
      a.outQty = a.outQty.plus(q.negated());
      a.outValue = a.outValue.plus(v.negated());
    } else {
      a.inQty = a.inQty.plus(q);
      a.inValue = a.inValue.plus(v);
    }
    acc.set(l.itemId, a);
  }
  const rows: TurnoverRow[] = items.flatMap((i) => {
    const a = acc.get(i.id);
    if (!a) return [];
    return [
      {
        itemId: i.id,
        code: i.code,
        name: i.name,
        unit: i.unit,
        ...a,
        closingQty: a.openingQty.plus(a.inQty).minus(a.outQty),
        closingValue: a.openingValue.plus(a.inValue).minus(a.outValue),
      },
    ];
  });
  const sumOf = (k: keyof ReturnType<typeof zero> | "closingValue") => rows.reduce((s, r) => s.plus(r[k]), dec(0));
  return {
    rows,
    totals: { openingValue: sumOf("openingValue"), inValue: sumOf("inValue"), outValue: sumOf("outValue"), closingValue: sumOf("closingValue") },
  };
}

export type AnalysisRow = { itemId: string; code: string; name: string; unit: string | null; quantity: Decimal; revenue: Decimal; cost: Decimal; margin: Decimal; marginPct: Decimal | null };

/** Laokaupade analüüs: müüdud kogus, müügitulu (eurodes, KM-ta), omahind ja müügikate perioodis. */
export async function stockAnalysis(tx: Tx, companyId: string, opts: { from: Date; to: Date }) {
  const [items, invoiceLines, sales] = await Promise.all([
    stockItems(tx, companyId),
    tx.salesInvoiceLine.findMany({
      where: { companyId, itemId: { not: null }, invoice: { status: "CONFIRMED", taxFree: false, type: { not: "PREPAYMENT" }, date: { gte: opts.from, lte: opts.to } } },
      select: { itemId: true, quantity: true, netAmount: true, invoice: { select: { currencyRate: true } } },
    }),
    tx.stockMovementLine.findMany({
      where: { companyId, movement: { status: "CONFIRMED", type: "SALE", date: { gte: opts.from, lte: opts.to } } },
      select: { itemId: true, totalCost: true },
    }),
  ]);
  const stock = new Set(items.map((i) => i.id));
  const acc = new Map<string, { quantity: Decimal; revenue: Decimal; cost: Decimal }>();
  const get = (id: string) => acc.get(id) ?? { quantity: dec(0), revenue: dec(0), cost: dec(0) };
  for (const l of invoiceLines) {
    if (!l.itemId || !stock.has(l.itemId)) continue;
    const a = get(l.itemId);
    acc.set(l.itemId, { ...a, quantity: a.quantity.plus(dec(l.quantity)), revenue: a.revenue.plus(toBase(l.netAmount, l.invoice.currencyRate.toString())) });
  }
  for (const l of sales) {
    const a = get(l.itemId);
    acc.set(l.itemId, { ...a, cost: a.cost.minus(dec(l.totalCost)) });
  }
  const rows: AnalysisRow[] = items.flatMap((i) => {
    const a = acc.get(i.id);
    if (!a) return [];
    const margin = a.revenue.minus(a.cost);
    return [{ itemId: i.id, code: i.code, name: i.name, unit: i.unit, ...a, margin, marginPct: a.revenue.isZero() ? null : margin.div(a.revenue).times(100) }];
  });
  rows.sort((a, b) => b.margin.comparedTo(a.margin));
  const revenue = rows.reduce((s, r) => s.plus(r.revenue), dec(0));
  const cost = rows.reduce((s, r) => s.plus(r.cost), dec(0));
  return { rows, totals: { revenue, cost, margin: revenue.minus(cost), marginPct: revenue.isZero() ? null : revenue.minus(cost).div(revenue).times(100) } };
}
