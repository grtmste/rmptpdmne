import { describe, expect, it } from "vitest";
import { parseISODate } from "@/lib/accounting/dates";
import { depreciationDue, depreciationSchedule, elapsedMonths, monthEnd, monthStart } from "@/lib/assets/depreciation";

const d = (s: string) => parseISODate(s)!;
const base = { cost: "1000", residualValue: "0", accumulated: "0", usefulLifeMonths: 36, monthsDone: 0, depreciationStart: d("2026-01-01") };

describe("kulum", () => {
  it("kuu algus, lõpp ja möödunud kuud", () => {
    expect(monthStart(d("2026-02-17")).toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(monthEnd(d("2028-02-03")).toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(elapsedMonths(d("2026-11-01"), d("2027-02-01"))).toBe(4);
    expect(elapsedMonths(d("2026-11-01"), d("2026-10-01"))).toBe(0);
  });

  it("lineaarne kuu kulum ja ümardus viimases kuus", () => {
    expect(depreciationDue(base, d("2026-01-01"))).toMatchObject({ months: 1 });
    expect(depreciationDue(base, d("2026-01-01")).amount.toFixed(2)).toBe("27.78");
    const plan = depreciationSchedule(base, d("2026-01-01"));
    expect(plan).toHaveLength(36);
    const total = plan.reduce((s, r) => s + Number(r.amount.toFixed(2)) * 100, 0) / 100;
    expect(total.toFixed(2)).toBe("1000.00");
    expect(plan.at(-1)!.bookValue.toFixed(2)).toBe("0.00");
  });

  it("lõppväärtus jääb alles", () => {
    const plan = depreciationSchedule({ ...base, residualValue: "100", usefulLifeMonths: 12 }, d("2026-01-01"));
    expect(plan[0]!.amount.toFixed(2)).toBe("75.00");
    expect(plan.at(-1)!.bookValue.toFixed(2)).toBe("100.00");
  });

  it("enne algust kulumit pole, vahele jäänud kuud arvestatakse järele", () => {
    expect(depreciationDue({ ...base, depreciationStart: d("2026-05-01") }, d("2026-04-01")).months).toBe(0);
    const late = depreciationDue(base, d("2026-03-01"));
    expect([late.months, late.amount.toFixed(2)]).toEqual([3, "83.33"]);
  });

  it("üle toodud vara jätkab järelejäänud elueaga", () => {
    // 24 kuud enne arvestatud 600, järel 12 kuud ja 400
    const r = depreciationDue({ ...base, accumulated: "600", monthsDone: 24, depreciationStart: d("2024-01-01") }, d("2026-01-01"));
    expect([r.months, r.amount.toFixed(2)]).toEqual([1, "33.33"]);
  });

  it("ümberhindamine ja eluea muutus mõjuvad edasiulatuvalt", () => {
    // 12 kuud tehtud (333,33), soetusmaksumus tõuseb 1300-ni, eluiga pikeneb 48 kuuni → (1300 − 333,33) / 36
    const r = depreciationDue({ ...base, cost: "1300", accumulated: "333.33", monthsDone: 12, usefulLifeMonths: 48 }, d("2027-01-01"));
    expect(r.amount.toFixed(2)).toBe("26.85");
  });

  it("täielikult amortiseerunud vara ei anna kulumit", () => {
    expect(depreciationDue({ ...base, accumulated: "1000", monthsDone: 36 }, d("2029-06-01")).months).toBe(0);
    expect(depreciationDue({ ...base, accumulated: "1000", monthsDone: 30 }, d("2028-07-01")).amount.toFixed(2)).toBe("0.00");
  });
});
