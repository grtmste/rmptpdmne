import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { toISODate } from "@/lib/accounting/dates";
import { depreciationDue, monthEnd, monthStart } from "@/lib/assets/depreciation";
import { dec, roundMoney, type DecimalInput } from "@/lib/money";
import { assertPeriodOpen, deleteJournalEntry, postJournalEntry, type JournalLineInput } from "./journal";

type Tx = Prisma.TransactionClient;

export type AssetErrorCode =
  | "assetNotFound"
  | "groupNotFound"
  | "locationNotFound"
  | "employeeNotFound"
  | "accountNotFound"
  | "departmentNotFound"
  | "invoiceNotFound"
  | "assetDisposed"
  | "financialLocked"
  | "assetInUse"
  | "residualTooHigh"
  | "openingTooHigh"
  | "startBeforeAcquisition"
  | "dateBeforeAcquisition"
  | "dateBeforeDepreciation"
  | "runExists"
  | "futurePeriod"
  | "laterRunExists"
  | "notLatestRun"
  | "runHasLaterEvents"
  | "runNotFound"
  | "nothingToDepreciate"
  | "nothingChanged"
  | "counterAccountRequired"
  | "sameGroup";

/** Põhivara reegli rikkumine; `code` on i18n võti nimeruumis `errors.assets`. */
export class AssetError extends Error {
  constructor(
    public code: AssetErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "AssetError";
  }
}

export type AssetInput = {
  id?: string;
  code: string;
  name: string;
  groupId: string;
  locationId?: string | null;
  responsibleId?: string | null;
  serialNumber?: string | null;
  acquisitionDate: Date;
  depreciationStart: Date;
  cost: DecimalInput;
  residualValue?: DecimalInput | null;
  usefulLifeMonths: number;
  openingDepreciation?: DecimalInput | null;
  openingMonths?: number | null;
  assetAccountId?: string | null;
  accumulatedAccountId?: string | null;
  expenseAccountId?: string | null;
  departmentId?: string | null;
  purchaseInvoiceId?: string | null;
  notes?: string | null;
};

async function account(tx: Tx, companyId: string, id: string) {
  const a = await tx.glAccount.findFirst({ where: { companyId, id, kind: "DETAIL" }, select: { id: true } });
  if (!a) throw new AssetError("accountNotFound");
  return a.id;
}

/** Vara seis: soetusmaksumus, akumuleeritud kulum ja arvestatud kuud (kõik kuni `until`, vaikimisi kõik). */
export async function assetState(tx: Tx, companyId: string, assetId: string) {
  const asset = await tx.fixedAsset.findFirst({ where: { companyId, id: assetId } });
  if (!asset) throw new AssetError("assetNotFound");
  const [lines, events] = await Promise.all([
    tx.depreciationLine.findMany({ where: { companyId, assetId }, select: { amount: true, months: true, run: { select: { date: true } } } }),
    tx.fixedAssetEvent.findMany({ where: { companyId, assetId }, select: { type: true, date: true, accumulatedDelta: true } }),
  ]);
  const accumulated = lines
    .reduce((s, l) => s.plus(dec(l.amount)), dec(asset.openingDepreciation))
    .plus(events.filter((e) => e.type !== "DISPOSAL").reduce((s, e) => s.plus(dec(e.accumulatedDelta)), dec(0)));
  const monthsDone = asset.openingMonths + lines.reduce((s, l) => s + l.months, 0);
  const lastDepreciation = lines.reduce<Date | null>((m, l) => (!m || l.run.date > m ? l.run.date : m), null);
  return { asset, accumulated, monthsDone, lastDepreciation, hasHistory: lines.length > 0 || events.length > 0 };
}

/** Salvestab vara. Pärast esimest kulumit või muutust saab muuta ainult mitterahalisi andmeid. */
export async function saveAsset(tx: Tx, companyId: string, userId: string | null, input: AssetInput) {
  const group = await tx.fixedAssetGroup.findFirst({ where: { companyId, id: input.groupId } });
  if (!group) throw new AssetError("groupNotFound");
  if (input.locationId && !(await tx.fixedAssetLocation.findFirst({ where: { companyId, id: input.locationId } }))) throw new AssetError("locationNotFound");
  if (input.responsibleId && !(await tx.employee.findFirst({ where: { companyId, id: input.responsibleId } }))) throw new AssetError("employeeNotFound");
  if (input.departmentId && !(await tx.department.findFirst({ where: { companyId, id: input.departmentId } }))) throw new AssetError("departmentNotFound");
  if (input.purchaseInvoiceId && !(await tx.purchaseInvoice.findFirst({ where: { companyId, id: input.purchaseInvoiceId } }))) throw new AssetError("invoiceNotFound");
  const cost = roundMoney(input.cost);
  const residual = roundMoney(input.residualValue ?? 0);
  const opening = roundMoney(input.openingDepreciation ?? 0);
  const openingMonths = input.openingMonths ?? 0;
  if (residual.greaterThan(cost)) throw new AssetError("residualTooHigh");
  if (opening.greaterThan(cost.minus(residual)) || openingMonths > input.usefulLifeMonths) throw new AssetError("openingTooHigh");
  const start = monthStart(input.depreciationStart);
  if (start < monthStart(input.acquisitionDate)) throw new AssetError("startBeforeAcquisition");

  const common = {
    code: input.code,
    name: input.name,
    locationId: input.locationId ?? null,
    responsibleId: input.responsibleId ?? null,
    serialNumber: input.serialNumber ?? null,
    departmentId: input.departmentId ?? null,
    purchaseInvoiceId: input.purchaseInvoiceId ?? null,
    notes: input.notes ?? null,
  };
  const financial = {
    groupId: group.id,
    acquisitionDate: input.acquisitionDate,
    depreciationStart: start,
    cost: cost.toFixed(2),
    residualValue: residual.toFixed(2),
    usefulLifeMonths: input.usefulLifeMonths,
    openingDepreciation: opening.toFixed(2),
    openingMonths,
    assetAccountId: await account(tx, companyId, input.assetAccountId || group.assetAccountId),
    accumulatedAccountId: await account(tx, companyId, input.accumulatedAccountId || group.accumulatedAccountId),
    expenseAccountId: await account(tx, companyId, input.expenseAccountId || group.expenseAccountId),
  };

  if (input.id) {
    const state = await assetState(tx, companyId, input.id);
    if (state.hasHistory) {
      const a = state.asset;
      const same =
        a.groupId === financial.groupId &&
        toISODate(a.acquisitionDate) === toISODate(financial.acquisitionDate) &&
        toISODate(a.depreciationStart) === toISODate(financial.depreciationStart) &&
        dec(a.cost).equals(cost) &&
        dec(a.residualValue).equals(residual) &&
        a.usefulLifeMonths === financial.usefulLifeMonths &&
        dec(a.openingDepreciation).equals(opening) &&
        a.openingMonths === openingMonths &&
        a.assetAccountId === financial.assetAccountId &&
        a.accumulatedAccountId === financial.accumulatedAccountId &&
        a.expenseAccountId === financial.expenseAccountId;
      if (!same) throw new AssetError("financialLocked");
      await tx.fixedAsset.update({ where: { id: input.id }, data: common });
      return input.id;
    }
    await tx.fixedAsset.update({ where: { id: input.id }, data: { ...common, ...financial } });
    return input.id;
  }
  const created = await tx.fixedAsset.create({ data: { companyId, ...common, ...financial, createdById: userId } });
  return created.id;
}

export async function deleteAsset(tx: Tx, companyId: string, id: string) {
  const state = await assetState(tx, companyId, id);
  if (state.hasHistory) throw new AssetError("assetInUse");
  await tx.fixedAsset.delete({ where: { id } });
}

// --- Kulum ------------------------------------------------------------------

export type DepreciationPreviewRow = { assetId: string; code: string; name: string; amount: Decimal; months: number; expenseAccountId: string; accumulatedAccountId: string; departmentId: string | null };

/** Kuu kulumi eelvaade (midagi ei salvestata). */
export async function previewDepreciation(tx: Tx, companyId: string, period: Date): Promise<DepreciationPreviewRow[]> {
  const date = monthEnd(period);
  const assets = await tx.fixedAsset.findMany({
    where: { companyId, status: "ACTIVE", depreciationStart: { lte: date }, acquisitionDate: { lte: date } },
    orderBy: { code: "asc" },
  });
  if (assets.length === 0) return [];
  const ids = assets.map((a) => a.id);
  const [lines, events] = await Promise.all([
    tx.depreciationLine.groupBy({ by: ["assetId"], where: { companyId, assetId: { in: ids } }, _sum: { amount: true, months: true } }),
    tx.fixedAssetEvent.groupBy({ by: ["assetId"], where: { companyId, assetId: { in: ids }, type: { not: "DISPOSAL" } }, _sum: { accumulatedDelta: true } }),
  ]);
  const lineBy = new Map(lines.map((l) => [l.assetId, l._sum]));
  const eventBy = new Map(events.map((e) => [e.assetId, dec(e._sum.accumulatedDelta ?? 0)]));
  const rows: DepreciationPreviewRow[] = [];
  for (const a of assets) {
    const l = lineBy.get(a.id);
    const due = depreciationDue(
      {
        cost: a.cost,
        residualValue: a.residualValue,
        accumulated: dec(a.openingDepreciation).plus(dec(l?.amount ?? 0)).plus(eventBy.get(a.id) ?? 0),
        usefulLifeMonths: a.usefulLifeMonths,
        monthsDone: a.openingMonths + (l?.months ?? 0),
        depreciationStart: a.depreciationStart,
      },
      monthStart(period),
    );
    if (due.months === 0 || due.amount.isZero()) continue;
    rows.push({ assetId: a.id, code: a.code, name: a.name, ...due, expenseAccountId: a.expenseAccountId, accumulatedAccountId: a.accumulatedAccountId, departmentId: a.departmentId });
  }
  return rows;
}

/** Arvestab kuu kulumi ja teeb kande (D kulumikulu / K akumuleeritud kulum). Kuud arvestatakse järjest. */
export async function runDepreciation(tx: Tx, companyId: string, userId: string | null, periodInput: Date) {
  const period = monthStart(periodInput);
  const date = monthEnd(period);
  await assertPeriodOpen(tx, companyId, date, "DEPRECIATION");
  if (await tx.depreciationRun.findFirst({ where: { companyId, period } })) throw new AssetError("runExists");
  const later = await tx.depreciationRun.findFirst({ where: { companyId, period: { gt: period } }, select: { period: true } });
  if (later) throw new AssetError("laterRunExists", { period: toISODate(later.period).slice(0, 7) });
  const rows = await previewDepreciation(tx, companyId, period);
  if (rows.length === 0) throw new AssetError("nothingToDepreciate");

  const total = rows.reduce((s, r) => s.plus(r.amount), dec(0));
  const run = await tx.depreciationRun.create({ data: { companyId, period, date, total: total.toFixed(2), createdById: userId } });
  await tx.depreciationLine.createMany({ data: rows.map((r) => ({ companyId, runId: run.id, assetId: r.assetId, amount: r.amount.toFixed(2), months: r.months })) });

  const debit = new Map<string, { accountId: string; departmentId: string | null; amount: Decimal }>();
  const credit = new Map<string, Decimal>();
  for (const r of rows) {
    const key = `${r.expenseAccountId}|${r.departmentId ?? ""}`;
    const d = debit.get(key) ?? { accountId: r.expenseAccountId, departmentId: r.departmentId, amount: dec(0) };
    debit.set(key, { ...d, amount: d.amount.plus(r.amount) });
    credit.set(r.accumulatedAccountId, (credit.get(r.accumulatedAccountId) ?? dec(0)).plus(r.amount));
  }
  const lines: JournalLineInput[] = [
    ...[...debit.values()].map((d) => ({ accountId: d.accountId, departmentId: d.departmentId, debit: d.amount.toFixed(2) })),
    ...[...credit].map(([accountId, amount]) => ({ accountId, credit: amount.toFixed(2) })),
  ];
  const entry = await postJournalEntry(tx, companyId, userId, {
    date,
    source: "DEPRECIATION",
    sourceId: run.id,
    description: `Põhivara kulum ${toISODate(period).slice(5, 7)}.${period.getUTCFullYear()}`,
    lines,
  });
  await tx.depreciationRun.update({ where: { id: run.id }, data: { journalEntryId: entry.id } });
  return { id: run.id, total, count: rows.length };
}

/** Tühistab viimase kulumi arvestuse (avatud perioodis, kui varadel pole hilisemaid muutusi). */
export async function cancelDepreciationRun(tx: Tx, companyId: string, id: string) {
  const run = await tx.depreciationRun.findFirst({ where: { companyId, id }, include: { lines: { select: { assetId: true } } } });
  if (!run) throw new AssetError("runNotFound");
  if (await tx.depreciationRun.findFirst({ where: { companyId, period: { gt: run.period } } })) throw new AssetError("notLatestRun");
  const events = await tx.fixedAssetEvent.count({ where: { companyId, assetId: { in: run.lines.map((l) => l.assetId) }, date: { gte: run.period } } });
  if (events > 0) throw new AssetError("runHasLaterEvents");
  await assertPeriodOpen(tx, companyId, run.date, "DEPRECIATION");
  if (run.journalEntryId) await deleteJournalEntry(tx, companyId, run.journalEntryId);
  await tx.depreciationRun.delete({ where: { id: run.id } });
}

// --- Muutused -----------------------------------------------------------------

async function activeForEvent(tx: Tx, companyId: string, assetId: string, date: Date) {
  const state = await assetState(tx, companyId, assetId);
  if (state.asset.status !== "ACTIVE") throw new AssetError("assetDisposed");
  if (date < state.asset.acquisitionDate) throw new AssetError("dateBeforeAcquisition");
  if (state.lastDepreciation && date < state.lastDepreciation) throw new AssetError("dateBeforeDepreciation", { date: toISODate(state.lastDepreciation) });
  await assertPeriodOpen(tx, companyId, date, "FIXED_ASSET");
  return state;
}

const side = (accountId: string, amount: Decimal): JournalLineInput =>
  amount.isNegative() ? { accountId, credit: amount.negated().toFixed(2) } : { accountId, debit: amount.toFixed(2) };

/**
 * Ümberhindamine: uus soetusmaksumus (vahe kirjendatakse vara kontole ja vastaskontole) ja/või uus kasulik
 * eluiga. Edasine kulum arvutatakse uue jääkväärtuse ja järelejäänud eluea järgi.
 */
export async function revalueAsset(
  tx: Tx,
  companyId: string,
  userId: string | null,
  input: { assetId: string; date: Date; newCost: DecimalInput; usefulLifeMonths?: number | null; counterAccountId?: string | null; description?: string | null },
) {
  const { asset, accumulated, monthsDone } = await activeForEvent(tx, companyId, input.assetId, input.date);
  const newCost = roundMoney(input.newCost);
  const delta = newCost.minus(dec(asset.cost));
  const life = input.usefulLifeMonths ?? asset.usefulLifeMonths;
  if (delta.isZero() && life === asset.usefulLifeMonths) throw new AssetError("nothingChanged");
  if (dec(asset.residualValue).greaterThan(newCost) || accumulated.greaterThan(newCost)) throw new AssetError("residualTooHigh");
  if (life < monthsDone) throw new AssetError("openingTooHigh");
  let journalEntryId: string | null = null;
  if (!delta.isZero()) {
    if (!input.counterAccountId) throw new AssetError("counterAccountRequired");
    const counter = await account(tx, companyId, input.counterAccountId);
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: input.date,
      source: "FIXED_ASSET",
      sourceId: asset.id,
      description: input.description || `Ümberhindamine: ${asset.code} ${asset.name}`,
      lines: [side(asset.assetAccountId, delta), side(counter, delta.negated())],
    });
    journalEntryId = entry.id;
  }
  await tx.fixedAsset.update({ where: { id: asset.id }, data: { cost: newCost.toFixed(2), usefulLifeMonths: life } });
  await tx.fixedAssetEvent.create({
    data: {
      companyId,
      assetId: asset.id,
      type: "REVALUATION",
      date: input.date,
      costDelta: delta.toFixed(2),
      usefulLifeMonths: life !== asset.usefulLifeMonths ? life : null,
      counterAccountId: input.counterAccountId ?? null,
      description: input.description ?? null,
      journalEntryId,
      createdById: userId,
    },
  });
}

/** Mahakandmine (ka müük): soetusmaksumus ja kulum maha, jääkväärtus valitud kulukontole. */
export async function disposeAsset(
  tx: Tx,
  companyId: string,
  userId: string | null,
  input: { assetId: string; date: Date; lossAccountId: string; description?: string | null },
) {
  const { asset, accumulated } = await activeForEvent(tx, companyId, input.assetId, input.date);
  const loss = await account(tx, companyId, input.lossAccountId);
  const cost = dec(asset.cost);
  const nbv = cost.minus(accumulated);
  const lines: JournalLineInput[] = [];
  if (!accumulated.isZero()) lines.push(side(asset.accumulatedAccountId, accumulated));
  if (!nbv.isZero()) lines.push(side(loss, nbv));
  if (!cost.isZero()) lines.push(side(asset.assetAccountId, cost.negated()));
  let journalEntryId: string | null = null;
  if (lines.length > 0) {
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: input.date,
      source: "FIXED_ASSET",
      sourceId: asset.id,
      description: input.description || `Mahakandmine: ${asset.code} ${asset.name}`,
      lines,
    });
    journalEntryId = entry.id;
  }
  await tx.fixedAsset.update({ where: { id: asset.id }, data: { status: "DISPOSED", disposedAt: input.date } });
  await tx.fixedAssetEvent.create({
    data: {
      companyId,
      assetId: asset.id,
      type: "DISPOSAL",
      date: input.date,
      costDelta: cost.negated().toFixed(2),
      accumulatedDelta: accumulated.negated().toFixed(2),
      counterAccountId: loss,
      description: input.description ?? null,
      journalEntryId,
      createdById: userId,
    },
  });
  return { bookValue: nbv };
}

/** Ümberklassifitseerimine teise gruppi; kui kontod muutuvad, kantakse soetusmaksumus ja kulum üle. */
export async function reclassifyAsset(
  tx: Tx,
  companyId: string,
  userId: string | null,
  input: { assetId: string; date: Date; groupId: string; description?: string | null },
) {
  const { asset, accumulated } = await activeForEvent(tx, companyId, input.assetId, input.date);
  const group = await tx.fixedAssetGroup.findFirst({ where: { companyId, id: input.groupId } });
  if (!group) throw new AssetError("groupNotFound");
  if (group.id === asset.groupId) throw new AssetError("sameGroup");
  const cost = dec(asset.cost);
  const lines: JournalLineInput[] = [];
  if (group.assetAccountId !== asset.assetAccountId && !cost.isZero()) {
    lines.push(side(group.assetAccountId, cost), side(asset.assetAccountId, cost.negated()));
  }
  if (group.accumulatedAccountId !== asset.accumulatedAccountId && !accumulated.isZero()) {
    lines.push(side(asset.accumulatedAccountId, accumulated), side(group.accumulatedAccountId, accumulated.negated()));
  }
  let journalEntryId: string | null = null;
  if (lines.length > 0) {
    const entry = await postJournalEntry(tx, companyId, userId, {
      date: input.date,
      source: "FIXED_ASSET",
      sourceId: asset.id,
      description: input.description || `Ümberklassifitseerimine: ${asset.code} ${asset.name}`,
      lines,
    });
    journalEntryId = entry.id;
  }
  await tx.fixedAsset.update({
    where: { id: asset.id },
    data: { groupId: group.id, assetAccountId: group.assetAccountId, accumulatedAccountId: group.accumulatedAccountId, expenseAccountId: group.expenseAccountId },
  });
  await tx.fixedAssetEvent.create({
    data: {
      companyId,
      assetId: asset.id,
      type: "RECLASSIFICATION",
      date: input.date,
      fromGroupId: asset.groupId,
      toGroupId: group.id,
      description: input.description ?? null,
      journalEntryId,
      createdById: userId,
    },
  });
}

/** Vaikimisi põhivara grupid Eesti kontoplaani järgi (kui ettevõttel gruppe veel pole). */
export const DEFAULT_ASSET_GROUPS: Array<{ name: string; asset: string; accumulated: string; expense: string; months: number }> = [
  { name: "Ehitised", asset: "1710", accumulated: "1790", expense: "4300", months: 240 },
  { name: "Masinad ja seadmed", asset: "1720", accumulated: "1790", expense: "4300", months: 60 },
  { name: "Transpordivahendid", asset: "1730", accumulated: "1790", expense: "4300", months: 60 },
  { name: "Inventar ja arvutid", asset: "1740", accumulated: "1790", expense: "4300", months: 36 },
  { name: "Immateriaalne põhivara", asset: "1800", accumulated: "1890", expense: "4300", months: 60 },
];

export async function ensureDefaultAssetGroups(tx: Tx, companyId: string, userId: string | null = null) {
  if ((await tx.fixedAssetGroup.count({ where: { companyId } })) > 0) return 0;
  const codes = [...new Set(DEFAULT_ASSET_GROUPS.flatMap((g) => [g.asset, g.accumulated, g.expense]))];
  const accounts = await tx.glAccount.findMany({ where: { companyId, code: { in: codes } }, select: { id: true, code: true } });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  const data = DEFAULT_ASSET_GROUPS.flatMap((g) => {
    const [asset, accumulated, expense] = [byCode.get(g.asset), byCode.get(g.accumulated), byCode.get(g.expense)];
    if (!asset || !accumulated || !expense) return [];
    return [{ companyId, name: g.name, assetAccountId: asset, accumulatedAccountId: accumulated, expenseAccountId: expense, usefulLifeMonths: g.months, createdById: userId }];
  });
  if (data.length) await tx.fixedAssetGroup.createMany({ data, skipDuplicates: true });
  return data.length;
}
