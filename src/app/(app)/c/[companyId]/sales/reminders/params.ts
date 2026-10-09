import { parseISODate } from "@/lib/accounting/dates";
import { todayLocal } from "@/lib/dates";

const str = (v: unknown) => (typeof v === "string" ? v : "");
export const OVERDUE_STEPS = ["1", "7", "14", "30", "60"] as const;

/** Meeldetuletuste lehe parameetrid: liik, seisukuupäev, minimaalne ületatud päevade arv. */
export function parseReminderQuery(sp: Record<string, string | string[] | undefined>) {
  const kind = str(sp.kind) === "STATEMENT" ? ("STATEMENT" as const) : ("REMINDER" as const);
  const asOf = parseISODate(str(sp.to)) ?? todayLocal();
  const days = (OVERDUE_STEPS as readonly string[]).includes(str(sp.days)) ? Number(str(sp.days)) : 1;
  return { kind, asOf, days };
}
