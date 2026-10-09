import "server-only";
import { db } from "@/lib/db";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";
import { defaultPeriod } from "@/server/reports/ledger";

type Params = Record<string, string | string[] | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Ühised aruandeparameetrid: periood (vaikimisi majandusaasta algusest tänaseni), rühmitus, otsing. */
export async function parseDocReportQuery<G extends string>(companyId: string, sp: Params, groups: readonly G[], defaultGroup: G) {
  const defaults = await defaultPeriod(db, companyId, todayLocal());
  let from = parseISODate(str(sp.from)) ?? defaults.from;
  let to = parseISODate(str(sp.to)) ?? defaults.to;
  if (from.getTime() > to.getTime()) [from, to] = [to, from];
  const g = str(sp.group) as G;
  return {
    from,
    to,
    fromIso: toISODate(from),
    toIso: toISODate(to),
    group: groups.includes(g) ? g : defaultGroup,
    search: str(sp.q).slice(0, 100),
    mode: str(sp.mode),
    detail: str(sp.detail) === "1",
  };
}
