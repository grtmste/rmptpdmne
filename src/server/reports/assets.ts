import type Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";

/**
 * Põhivara aruanded. Soetusmaksumus ja akumuleeritud kulum mis tahes kuupäeva seisuga arvutatakse
 * varast (algne maksumus, enne arvestust tehtud kulum), kulumiarvestustest ja muutustest.
 */

type Tx = Prisma.TransactionClient;

type Loaded = Awaited<ReturnType<typeof load>>;

async function load(tx: Tx, companyId: string, opts: { groupId?: string | null; locationId?: string | null; responsibleId?: string | null } = {}) {
  const assets = await tx.fixedAsset.findMany({
    where: {
      companyId,
      ...(opts.groupId ? { groupId: opts.groupId } : {}),
      ...(opts.locationId ? { locationId: opts.locationId } : {}),
      ...(opts.responsibleId ? { responsibleId: opts.responsibleId } : {}),
    },
    orderBy: { code: "asc" },
    include: {
      group: { select: { id: true, name: true } },
      location: { select: { name: true } },
      events: { select: { type: true, date: true, costDelta: true, accumulatedDelta: true } },
      depreciationLines: { select: { amount: true, run: { select: { date: true } } } },
    },
  });
  return assets;
}

const before = (d: Date, limit: Date) => d.getTime() <= limit.getTime();

/** Soetusmaksumus ja akumuleeritud kulum kuupäeva lõpu seisuga. */
function stateAt(a: Loaded[number], date: Date) {
  const revaluations = a.events.filter((e) => e.type === "REVALUATION").reduce((s, e) => s.plus(dec(e.costDelta)), dec(0));
  const acquired = before(a.acquisitionDate, date);
  const initialCost = dec(a.cost).minus(revaluations);
  const cost = (acquired ? initialCost : dec(0)).plus(a.events.filter((e) => before(e.date, date)).reduce((s, e) => s.plus(dec(e.costDelta)), dec(0)));
  const accumulated = (acquired ? dec(a.openingDepreciation) : dec(0))
    .plus(a.depreciationLines.filter((l) => before(l.run.date, date)).reduce((s, l) => s.plus(dec(l.amount)), dec(0)))
    .plus(a.events.filter((e) => before(e.date, date)).reduce((s, e) => s.plus(dec(e.accumulatedDelta)), dec(0)));
  return { cost, accumulated };
}

export type AssetListRow = {
  id: string;
  code: string;
  name: string;
  group: string;
  location: string | null;
  responsibleId: string | null;
  status: "ACTIVE" | "DISPOSED";
  acquisitionDate: Date;
  usefulLifeMonths: number;
  cost: Decimal;
  accumulated: Decimal;
  bookValue: Decimal;
};

/** Põhivarade nimekiri kuupäeva seisuga (soetatud selleks kuupäevaks; maha kantud ainult soovi korral). */
export async function assetList(
  tx: Tx,
  companyId: string,
  opts: { date: Date; groupId?: string | null; locationId?: string | null; responsibleId?: string | null; includeDisposed?: boolean },
) {
  const assets = await load(tx, companyId, opts);
  const rows: AssetListRow[] = [];
  for (const a of assets) {
    if (!before(a.acquisitionDate, opts.date)) continue;
    const disposed = a.disposedAt ? before(a.disposedAt, opts.date) : false;
    if (disposed && !opts.includeDisposed) continue;
    const s = stateAt(a, opts.date);
    rows.push({
      id: a.id,
      code: a.code,
      name: a.name,
      group: a.group.name,
      location: a.location?.name ?? null,
      responsibleId: a.responsibleId,
      status: disposed ? "DISPOSED" : "ACTIVE",
      acquisitionDate: a.acquisitionDate,
      usefulLifeMonths: a.usefulLifeMonths,
      cost: s.cost,
      accumulated: s.accumulated,
      bookValue: s.cost.minus(s.accumulated),
    });
  }
  const sumOf = (k: "cost" | "accumulated" | "bookValue") => rows.reduce((s, r) => s.plus(r[k]), dec(0));
  return { rows, totals: { cost: sumOf("cost"), accumulated: sumOf("accumulated"), bookValue: sumOf("bookValue") } };
}

export type DepreciationReportRow = { id: string; code: string; name: string; group: string; cost: Decimal; amount: Decimal; accumulated: Decimal; bookValue: Decimal };

/** Kulumiaruanne: perioodi kulum varade kaupa koos perioodi lõpu seisuga. */
export async function depreciationReport(tx: Tx, companyId: string, opts: { from: Date; to: Date; groupId?: string | null }) {
  const assets = await load(tx, companyId, { groupId: opts.groupId });
  const rows: DepreciationReportRow[] = [];
  for (const a of assets) {
    const amount = a.depreciationLines
      .filter((l) => l.run.date.getTime() >= opts.from.getTime() && before(l.run.date, opts.to))
      .reduce((s, l) => s.plus(dec(l.amount)), dec(0));
    if (amount.isZero()) continue;
    const s = stateAt(a, opts.to);
    rows.push({ id: a.id, code: a.code, name: a.name, group: a.group.name, cost: s.cost, amount, accumulated: s.accumulated, bookValue: s.cost.minus(s.accumulated) });
  }
  rows.sort((x, y) => x.group.localeCompare(y.group) || x.code.localeCompare(y.code));
  return { rows, total: rows.reduce((s, r) => s.plus(r.amount), dec(0)) };
}

export type SummaryRow = {
  groupId: string;
  group: string;
  openingCost: Decimal;
  additions: Decimal;
  revaluations: Decimal;
  disposals: Decimal;
  closingCost: Decimal;
  openingAccumulated: Decimal;
  depreciation: Decimal;
  accumulatedDisposals: Decimal;
  closingAccumulated: Decimal;
  openingBookValue: Decimal;
  closingBookValue: Decimal;
};

/** Koondaruanne gruppide kaupa (põhivara liikumine perioodis, nagu majandusaasta aruande lisas). */
export async function assetSummary(tx: Tx, companyId: string, opts: { from: Date; to: Date }) {
  const assets = await load(tx, companyId);
  const dayBefore = new Date(opts.from.getTime() - 86_400_000);
  const inPeriod = (d: Date) => d.getTime() >= opts.from.getTime() && before(d, opts.to);
  const groups = new Map<string, SummaryRow>();
  for (const a of assets) {
    const g =
      groups.get(a.group.id) ??
      ({
        groupId: a.group.id,
        group: a.group.name,
        openingCost: dec(0),
        additions: dec(0),
        revaluations: dec(0),
        disposals: dec(0),
        closingCost: dec(0),
        openingAccumulated: dec(0),
        depreciation: dec(0),
        accumulatedDisposals: dec(0),
        closingAccumulated: dec(0),
        openingBookValue: dec(0),
        closingBookValue: dec(0),
      } satisfies SummaryRow);
    const open = stateAt(a, dayBefore);
    const close = stateAt(a, opts.to);
    const revaluationTotal = a.events.filter((e) => e.type === "REVALUATION").reduce((s, e) => s.plus(dec(e.costDelta)), dec(0));
    if (inPeriod(a.acquisitionDate)) g.additions = g.additions.plus(dec(a.cost).minus(revaluationTotal));
    for (const e of a.events.filter((x) => inPeriod(x.date))) {
      if (e.type === "REVALUATION") g.revaluations = g.revaluations.plus(dec(e.costDelta));
      if (e.type === "DISPOSAL") {
        g.disposals = g.disposals.plus(dec(e.costDelta).negated());
        g.accumulatedDisposals = g.accumulatedDisposals.plus(dec(e.accumulatedDelta).negated());
      }
    }
    // Enne arvestuse algust tehtud kulum tuleb koos soetusega
    const openingAcc = inPeriod(a.acquisitionDate) ? dec(a.openingDepreciation) : dec(0);
    g.depreciation = g.depreciation.plus(a.depreciationLines.filter((l) => inPeriod(l.run.date)).reduce((s, l) => s.plus(dec(l.amount)), openingAcc));
    g.openingCost = g.openingCost.plus(open.cost);
    g.closingCost = g.closingCost.plus(close.cost);
    g.openingAccumulated = g.openingAccumulated.plus(open.accumulated);
    g.closingAccumulated = g.closingAccumulated.plus(close.accumulated);
    g.openingBookValue = g.openingCost.minus(g.openingAccumulated);
    g.closingBookValue = g.closingCost.minus(g.closingAccumulated);
    groups.set(a.group.id, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
  const keys = ["openingCost", "additions", "revaluations", "disposals", "closingCost", "openingAccumulated", "depreciation", "accumulatedDisposals", "closingAccumulated", "openingBookValue", "closingBookValue"] as const;
  const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s.plus(r[k]), dec(0))])) as Record<(typeof keys)[number], Decimal>;
  return { rows, totals };
}
