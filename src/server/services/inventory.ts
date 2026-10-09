import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { periodState } from "@/lib/accounting/fiscal";
import { toISODate } from "@/lib/accounting/dates";
import { firstNegative, replayCosts, type CostMethod, type StockEvent } from "@/lib/inventory/costing";
import { dec, roundMoney, type DecimalInput } from "@/lib/money";
import { assertPeriodOpen, postJournalEntry } from "./journal";
import { nextDocumentNumber } from "./numbering";

type Tx = Prisma.TransactionClient;

export type InventoryErrorCode =
  | "warehouseNotFound"
  | "warehouseInUse"
  | "sameWarehouse"
  | "itemNotFound"
  | "notStockItem"
  | "noLines"
  | "quantityPositive"
  | "movementNotFound"
  | "notDraft"
  | "counterAccountRequired"
  | "accountNotFound"
  | "missingRoleAccount"
  | "insufficientStock"
  | "stockItemHasMovements";

/** Lao reegli rikkumine; `code` on i18n võti nimeruumis `errors.inventory`. */
export class InventoryError extends Error {
  constructor(
    public code: InventoryErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "InventoryError";
  }
}

export type ManualMovementType = "RECEIPT" | "ISSUE" | "TRANSFER" | "COUNT";

export type MovementLineInput = {
  itemId: string;
  /** Sissetulek, väljaminek, ümberpaigutus: positiivne kogus; inventuur: loendatud kogus (≥ 0) */
  quantity: DecimalInput;
  /** Sissetuleku ühikuhind (tühi = jooksev omahind) */
  unitCost?: DecimalInput | null;
};

export type MovementInput = {
  id?: string;
  type: ManualMovementType;
  date: Date;
  warehouseId: string;
  toWarehouseId?: string | null;
  counterAccountId?: string | null;
  description?: string | null;
  lines: MovementLineInput[];
};

const isBlank = (v: DecimalInput | null | undefined) => v === null || v === undefined || v === "";

async function role(tx: Tx, companyId: string, r: "INVENTORY" | "COST_OF_GOODS_SOLD") {
  const a = await tx.glAccount.findFirst({ where: { companyId, role: r }, select: { id: true } });
  if (!a) throw new InventoryError("missingRoleAccount", { role: r });
  return a.id;
}

/** Laokonto rollikonto või null (ostuarve kasutab seda laokaupade ridadel). */
export async function inventoryRoleAccount(tx: Tx, companyId: string) {
  return (await tx.glAccount.findFirst({ where: { companyId, role: "INVENTORY" }, select: { id: true } }))?.id ?? null;
}

/** Vaikimisi ladu; kui ettevõttel ladu pole, luuakse „Põhiladu“. */
export async function defaultWarehouseId(tx: Tx, companyId: string, userId: string | null = null) {
  const existing = await tx.warehouse.findFirst({ where: { companyId, active: true }, orderBy: [{ isDefault: "desc" }, { code: "asc" }], select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.warehouse.upsert({
    where: { companyId_code: { companyId, code: "PL" } },
    create: { companyId, code: "PL", name: "Põhiladu", isDefault: true, createdById: userId },
    update: { active: true },
  });
  return created.id;
}

async function assertWarehouse(tx: Tx, companyId: string, id: string) {
  const w = await tx.warehouse.findFirst({ where: { companyId, id }, select: { id: true } });
  if (!w) throw new InventoryError("warehouseNotFound");
}

async function stockItems(tx: Tx, companyId: string, ids: string[]) {
  const items = await tx.item.findMany({ where: { companyId, id: { in: [...new Set(ids)] } } });
  return new Map(items.map((i) => [i.id, i]));
}

/** Salvestab käsitsi liikumise mustandi (sissetulek, väljaminek, ümberpaigutus, inventuur). */
export async function saveMovementDraft(tx: Tx, companyId: string, userId: string | null, input: MovementInput) {
  await assertWarehouse(tx, companyId, input.warehouseId);
  if (input.type === "TRANSFER") {
    if (!input.toWarehouseId) throw new InventoryError("warehouseNotFound");
    if (input.toWarehouseId === input.warehouseId) throw new InventoryError("sameWarehouse");
    await assertWarehouse(tx, companyId, input.toWarehouseId);
  }
  if (input.counterAccountId) {
    const a = await tx.glAccount.findFirst({ where: { companyId, id: input.counterAccountId, kind: "DETAIL" }, select: { id: true } });
    if (!a) throw new InventoryError("accountNotFound");
  }
  const lines = input.lines.filter((l) => l.itemId);
  if (lines.length === 0) throw new InventoryError("noLines");
  const items = await stockItems(tx, companyId, lines.map((l) => l.itemId));
  const rows = lines.map((l, index) => {
    const item = items.get(l.itemId);
    if (!item) throw new InventoryError("itemNotFound", { index });
    if (!item.trackStock) throw new InventoryError("notStockItem", { index, item: item.code });
    const q = dec(isBlank(l.quantity) ? 0 : l.quantity);
    if (input.type === "COUNT" ? q.isNegative() : !q.greaterThan(0)) throw new InventoryError("quantityPositive", { index });
    const unitCost = input.type === "RECEIPT" && !isBlank(l.unitCost) ? dec(l.unitCost) : null;
    if (unitCost?.isNegative()) throw new InventoryError("quantityPositive", { index });
    return {
      companyId,
      itemId: item.id,
      sortOrder: index,
      quantity: input.type === "COUNT" ? "0" : (input.type === "ISSUE" ? q.negated() : q).toFixed(4),
      countedQuantity: input.type === "COUNT" ? q.toFixed(4) : null,
      unitCost: unitCost?.toFixed(4) ?? "0",
      fixedCost: unitCost !== null,
      totalCost: unitCost ? roundMoney(q.times(unitCost)).toFixed(2) : "0",
    };
  });
  const data = {
    type: input.type,
    date: input.date,
    warehouseId: input.warehouseId,
    toWarehouseId: input.type === "TRANSFER" ? input.toWarehouseId! : null,
    counterAccountId: input.type === "TRANSFER" ? null : (input.counterAccountId ?? null),
    description: input.description?.trim() || null,
  };
  let id = input.id;
  if (id) {
    const existing = await tx.stockMovement.findFirst({ where: { companyId, id }, select: { status: true, type: true } });
    if (!existing || existing.type === "SALE" || existing.type === "PURCHASE") throw new InventoryError("movementNotFound");
    if (existing.status !== "DRAFT") throw new InventoryError("notDraft");
    await tx.stockMovement.update({ where: { id }, data });
    await tx.stockMovementLine.deleteMany({ where: { companyId, movementId: id } });
  } else {
    id = (await tx.stockMovement.create({ data: { companyId, ...data, createdById: userId } })).id;
  }
  await tx.stockMovementLine.createMany({ data: rows.map((r) => ({ ...r, movementId: id })) });
  return id;
}

export async function deleteMovementDraft(tx: Tx, companyId: string, id: string) {
  const m = await tx.stockMovement.findFirst({ where: { companyId, id }, select: { status: true } });
  if (!m) throw new InventoryError("movementNotFound");
  if (m.status !== "DRAFT") throw new InventoryError("notDraft");
  await tx.stockMovement.delete({ where: { id } });
}

/** Kinnitatud kogused lao kaupa kuni kuupäevani (k.a): Map(`itemId|warehouseId` → kogus). */
export async function bookQuantities(tx: Tx, companyId: string, opts: { until?: Date; itemIds?: string[]; warehouseId?: string } = {}) {
  const lines = await tx.stockMovementLine.findMany({
    where: {
      companyId,
      ...(opts.itemIds ? { itemId: { in: opts.itemIds } } : {}),
      movement: { status: "CONFIRMED", ...(opts.until ? { date: { lte: opts.until } } : {}) },
    },
    select: { itemId: true, quantity: true, movement: { select: { type: true, warehouseId: true, toWarehouseId: true } } },
  });
  const out = new Map<string, Decimal>();
  const add = (itemId: string, warehouseId: string, q: Decimal) => {
    const key = `${itemId}|${warehouseId}`;
    out.set(key, (out.get(key) ?? dec(0)).plus(q));
  };
  for (const l of lines) {
    const q = dec(l.quantity);
    if (l.movement.type === "TRANSFER") {
      add(l.itemId, l.movement.warehouseId, q.negated());
      add(l.itemId, l.movement.toWarehouseId!, q);
    } else add(l.itemId, l.movement.warehouseId, q);
  }
  if (opts.warehouseId) for (const k of [...out.keys()]) if (!k.endsWith(`|${opts.warehouseId}`)) out.delete(k);
  return out;
}

/** Kinnitab käsitsi liikumise: inventuuri vahe, koguse kontroll, omahind ja kanne. */
export async function confirmMovement(tx: Tx, companyId: string, userId: string | null, id: string) {
  const m = await tx.stockMovement.findFirst({ where: { companyId, id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!m) throw new InventoryError("movementNotFound");
  if (m.status !== "DRAFT") throw new InventoryError("notDraft");
  if (m.lines.length === 0) throw new InventoryError("noLines");
  await assertPeriodOpen(tx, companyId, m.date, "INVENTORY");
  const items = await stockItems(tx, companyId, m.lines.map((l) => l.itemId));
  for (const [index, l] of m.lines.entries()) {
    if (!items.get(l.itemId)?.trackStock) throw new InventoryError("notStockItem", { index, item: items.get(l.itemId)?.code ?? "" });
  }
  if (m.type === "COUNT") {
    // Vahe arvestusliku kogusega kuupäeva lõpu seisuga
    const book = await bookQuantities(tx, companyId, { until: m.date, itemIds: m.lines.map((l) => l.itemId), warehouseId: m.warehouseId });
    const seen = new Map<string, Decimal>();
    for (const l of m.lines) {
      const before = seen.get(l.itemId) ?? book.get(`${l.itemId}|${m.warehouseId}`) ?? dec(0);
      const diff = dec(l.countedQuantity ?? 0).minus(before);
      seen.set(l.itemId, dec(l.countedQuantity ?? 0));
      await tx.stockMovementLine.update({ where: { id: l.id }, data: { quantity: diff.toFixed(4), totalCost: "0", fixedCost: false } });
    }
  }
  const number = await nextDocumentNumber(tx, companyId, "STOCK_MOVEMENT", m.date);
  const res = await tx.stockMovement.updateMany({
    where: { companyId, id, status: "DRAFT" },
    data: { status: "CONFIRMED", number, confirmedAt: new Date(), confirmedById: userId },
  });
  if (res.count !== 1) throw new InventoryError("notDraft");
  await settle(tx, companyId, userId, id);
  return { id, number };
}

export type DocumentStockLine = {
  itemId: string;
  /** Kogus märgiga (laoseisu muutus) */
  quantity: DecimalInput;
  /** Fikseeritud väärtus märgiga (ostu sissetulek) */
  value?: DecimalInput | null;
  /** Lähtedokumendi poolt laokontole kirjendatud summa märgiga */
  bookedCost?: DecimalInput;
};

/**
 * Müügi- või ostuarve laoliikumine (arve kinnitamisel). Arvestatakse ainult laokaupade read;
 * kui neid pole, liikumist ei teki. Kreeditarvega tagastatud kaup võetakse lattu algse müügi omahinnaga.
 */
export async function postDocumentMovement(
  tx: Tx,
  companyId: string,
  userId: string | null,
  input: {
    type: "SALE" | "PURCHASE";
    date: Date;
    warehouseId: string | null;
    number: string;
    description: string;
    salesInvoiceId?: string;
    purchaseInvoiceId?: string;
    creditOfSalesInvoiceId?: string | null;
    lines: DocumentStockLine[];
  },
) {
  const items = await stockItems(tx, companyId, input.lines.map((l) => l.itemId));
  const lines = input.lines.filter((l) => items.get(l.itemId)?.trackStock && (!dec(l.quantity).isZero() || !dec(l.value ?? 0).isZero()));
  if (lines.length === 0) return null;
  const warehouseId = input.warehouseId ?? (await defaultWarehouseId(tx, companyId, userId));
  await assertWarehouse(tx, companyId, warehouseId);

  // Tagastuse omahind: algse müügiarve liikumise keskmine ühikuhind artikli kaupa
  const returnCost = new Map<string, Decimal>();
  if (input.creditOfSalesInvoiceId) {
    const orig = await tx.stockMovementLine.findMany({
      where: { companyId, movement: { salesInvoiceId: input.creditOfSalesInvoiceId, status: "CONFIRMED" } },
      select: { itemId: true, quantity: true, totalCost: true },
    });
    const agg = new Map<string, { q: Decimal; v: Decimal }>();
    for (const o of orig) {
      const a = agg.get(o.itemId) ?? { q: dec(0), v: dec(0) };
      agg.set(o.itemId, { q: a.q.plus(dec(o.quantity)), v: a.v.plus(dec(o.totalCost)) });
    }
    for (const [itemId, a] of agg) if (!a.q.isZero()) returnCost.set(itemId, a.v.div(a.q).abs());
  }

  const movement = await tx.stockMovement.create({
    data: {
      companyId,
      type: input.type,
      status: "CONFIRMED",
      number: input.number,
      date: input.date,
      warehouseId,
      description: input.description,
      salesInvoiceId: input.salesInvoiceId ?? null,
      purchaseInvoiceId: input.purchaseInvoiceId ?? null,
      confirmedAt: new Date(),
      confirmedById: userId,
      createdById: userId,
    },
  });
  await tx.stockMovementLine.createMany({
    data: lines.map((l, i) => {
      const q = dec(l.quantity);
      let value = l.value != null ? roundMoney(l.value) : null;
      const back = returnCost.get(l.itemId);
      if (value === null && q.isPositive() && back) value = roundMoney(q.times(back));
      return {
        companyId,
        movementId: movement.id,
        itemId: l.itemId,
        sortOrder: i,
        quantity: q.toFixed(4),
        fixedCost: value !== null,
        totalCost: value?.toFixed(2) ?? "0",
        unitCost: value && !q.isZero() ? value.div(q).abs().toFixed(4) : "0",
        bookedCost: roundMoney(l.bookedCost ?? 0).toFixed(2),
      };
    }),
  });
  await settle(tx, companyId, userId, movement.id);
  return movement.id;
}

/** Koguse kontroll (kogu ajalugu) ja omahinna arvestus pärast liikumise kinnitamist. */
async function settle(tx: Tx, companyId: string, userId: string | null, movementId: string) {
  const lines = await tx.stockMovementLine.findMany({ where: { companyId, movementId }, select: { itemId: true } });
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  await assertNoNegative(tx, companyId, itemIds);
  await recalculateItems(tx, companyId, userId, { itemIds, force: [movementId] });
}

async function assertNoNegative(tx: Tx, companyId: string, itemIds: string[]) {
  const lines = await confirmedLines(tx, companyId, itemIds, true);
  const events = lines.flatMap((l, seq) => {
    const date = toISODate(l.movement.date);
    if (l.movement.type === "TRANSFER") {
      return [
        { date, seq, itemId: l.itemId, warehouseId: l.movement.warehouseId, quantity: dec(l.quantity).negated() },
        { date, seq, itemId: l.itemId, warehouseId: l.movement.toWarehouseId!, quantity: dec(l.quantity) },
      ];
    }
    return [{ date, seq, itemId: l.itemId, warehouseId: l.movement.warehouseId, quantity: l.quantity }];
  });
  const neg = firstNegative(events);
  if (!neg) return;
  const [item, warehouse] = await Promise.all([
    tx.item.findFirst({ where: { companyId, id: neg.itemId }, select: { code: true, name: true } }),
    tx.warehouse.findFirst({ where: { companyId, id: neg.warehouseId }, select: { name: true } }),
  ]);
  throw new InventoryError("insufficientStock", {
    item: item ? `${item.code} ${item.name}` : "",
    warehouse: warehouse?.name ?? "",
    date: neg.date,
    missing: neg.quantity.negated().toFixed(4).replace(/\.?0+$/, ""),
  });
}

/** Kinnitatud read kronoloogilises järjekorras (kinnitamise järjekord sama kuupäeva sees). */
async function confirmedLines(tx: Tx, companyId: string, itemIds: string[] | null, withTransfers: boolean) {
  const lines = await tx.stockMovementLine.findMany({
    where: {
      companyId,
      ...(itemIds ? { itemId: { in: itemIds } } : {}),
      movement: { status: "CONFIRMED", ...(withTransfers ? {} : { type: { not: "TRANSFER" } }) },
    },
    include: { movement: { select: { id: true, type: true, date: true, warehouseId: true, toWarehouseId: true, confirmedAt: true } } },
  });
  return lines.sort(
    (a, b) =>
      a.movement.date.getTime() - b.movement.date.getTime() ||
      (a.movement.confirmedAt?.getTime() ?? 0) - (b.movement.confirmedAt?.getTime() ?? 0) ||
      (a.movement.id < b.movement.id ? -1 : a.movement.id > b.movement.id ? 1 : 0) ||
      a.sortOrder - b.sortOrder,
  );
}

/**
 * Omahinna ümberarvestus: mängib artiklite liikumised läbi, uuendab avatud perioodi liikumiste
 * omahinnad ja nende kanded. Suletud perioodi liikumisi ei muudeta (nende väärtus on fikseeritud).
 * Tagastab muudetud liikumiste arvu.
 */
export async function recalculateItems(
  tx: Tx,
  companyId: string,
  userId: string | null,
  opts: { itemIds?: string[]; force?: string[] } = {},
) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { costMethod: true, lockedUntil: true } });
  const years = await tx.fiscalYear.findMany({ where: { companyId } });
  const itemIds = opts.itemIds ?? (await tx.item.findMany({ where: { companyId, trackStock: true }, select: { id: true } })).map((i) => i.id);
  if (itemIds.length === 0) return 0;
  const items = await stockItems(tx, companyId, itemIds);
  const lines = await confirmedLines(tx, companyId, itemIds, false);
  const openCache = new Map<number, boolean>();
  const isOpen = (d: Date) => {
    if (!openCache.has(d.getTime())) openCache.set(d.getTime(), periodState(d, years, company.lockedUntil) === "open");
    return openCache.get(d.getTime())!;
  };

  const byItem = new Map<string, typeof lines>();
  for (const l of lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
  const changedLines: Array<{ id: string; totalCost: string; unitCost: string }> = [];
  for (const [itemId, list] of byItem) {
    const events: StockEvent[] = list.map((l, seq) => ({
      id: l.id,
      date: toISODate(l.movement.date),
      seq,
      quantity: l.quantity,
      value: l.fixedCost || !isOpen(l.movement.date) ? l.totalCost : null,
    }));
    const { results } = replayCosts(events, company.costMethod as CostMethod, items.get(itemId)?.purchasePrice ?? 0);
    for (const l of list) {
      const r = results.get(l.id)!;
      if (!isOpen(l.movement.date)) continue;
      if (!r.totalCost.equals(dec(l.totalCost)) || !r.unitCost.equals(dec(l.unitCost))) {
        changedLines.push({ id: l.id, totalCost: r.totalCost.toFixed(2), unitCost: r.unitCost.toFixed(4) });
      }
    }
  }
  for (const c of changedLines) await tx.stockMovementLine.update({ where: { id: c.id }, data: { totalCost: c.totalCost, unitCost: c.unitCost } });

  const changedIds = new Set(changedLines.map((c) => c.id));
  const changed = new Set(lines.filter((l) => changedIds.has(l.id)).map((l) => l.movementId));
  for (const id of new Set([...changed, ...(opts.force ?? [])])) await repost(tx, companyId, userId, id);
  return changed.size;
}

/** Liikumise omahinna kanne: laoseisu väärtuse muutus miinus see, mis lähtedokument juba kirjendas. */
async function repost(tx: Tx, companyId: string, userId: string | null, movementId: string) {
  const m = await tx.stockMovement.findFirstOrThrow({ where: { companyId, id: movementId }, include: { lines: { include: { item: true } } } });
  const amounts = new Map<string, Decimal>();
  const add = (accountId: string, v: Decimal) => amounts.set(accountId, (amounts.get(accountId) ?? dec(0)).plus(v));
  let inventory: string | null = null;
  let cogs: string | null = null;
  for (const l of m.lines) {
    const delta = dec(l.totalCost).minus(dec(l.bookedCost));
    if (delta.isZero()) continue;
    const inv = l.item.inventoryAccountId ?? (inventory ??= await role(tx, companyId, "INVENTORY"));
    let counter: string | null;
    if (m.type === "SALE" || m.type === "PURCHASE") counter = l.item.cogsAccountId ?? (cogs ??= await role(tx, companyId, "COST_OF_GOODS_SOLD"));
    else counter = m.counterAccountId;
    if (!counter) throw new InventoryError("counterAccountRequired");
    add(inv, delta);
    add(counter, delta.negated());
  }
  if (m.journalEntryId) {
    await tx.journalEntry.deleteMany({ where: { companyId, id: m.journalEntryId } });
  }
  const entryLines = [...amounts].filter(([, v]) => !v.isZero());
  let journalEntryId: string | null = null;
  if (entryLines.length > 0) {
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: m.date,
      source: "INVENTORY",
      sourceId: m.id,
      number: m.number ?? undefined,
      description: m.description,
      lines: entryLines.map(([accountId, v]) => ({
        accountId,
        debit: v.isPositive() ? v.toFixed(2) : "0",
        credit: v.isNegative() ? v.negated().toFixed(2) : "0",
      })),
    });
    journalEntryId = entry.id;
  }
  const total = m.lines.reduce((s, l) => s.plus(dec(l.totalCost)), dec(0));
  await tx.stockMovement.update({ where: { id: m.id }, data: { journalEntryId, totalCost: m.type === "TRANSFER" ? "0" : total.toFixed(2) } });
}

/** Kas artiklil on laoliikumisi (laokaubaks märkimist ei saa siis maha võtta). */
export async function itemHasMovements(tx: Tx, companyId: string, itemId: string) {
  return (await tx.stockMovementLine.count({ where: { companyId, itemId } })) > 0;
}
