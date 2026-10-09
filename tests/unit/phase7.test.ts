import { describe, expect, it } from "vitest";
import { parseISODate, toISODate } from "@/lib/accounting/dates";
import { fillPlaceholders, nextOccurrence, occurrenceDate } from "@/lib/sales/recurring";
import { lateInterest } from "@/lib/sales/interest";

const d = (s: string) => parseISODate(s)!;

describe("perioodiline arve", () => {
  it("kuupäevad algusest, kuu lõpu korral viimane päev", () => {
    const start = d("2026-01-31");
    expect([0, 1, 2, 3].map((n) => toISODate(occurrenceDate(start, 1, n)))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(toISODate(occurrenceDate(d("2026-03-15"), 3, 2))).toBe("2026-09-15");
    expect(toISODate(nextOccurrence(d("2026-01-01"), 12, 1, null)!)).toBe("2027-01-01");
    expect(nextOccurrence(d("2026-01-01"), 1, 3, d("2026-03-01"))).toBeNull();
    expect(toISODate(nextOccurrence(d("2026-01-01"), 1, 2, d("2026-03-01"))!)).toBe("2026-03-01");
  });

  it("kohatäited arve keeles", () => {
    const opts = { date: d("2026-10-01"), intervalMonths: 1, locale: "et" };
    expect(fillPlaceholders("Haldustasu [kuu] [aasta]", opts)).toBe("Haldustasu oktoober 2026");
    expect(fillPlaceholders("Periood: [PERIOOD], ette [järgmine kuu]", opts)).toBe("Periood: oktoober 2026, ette november");
    expect(fillPlaceholders("Fee for [month]", { ...opts, locale: "en" })).toBe("Fee for October");
    expect(fillPlaceholders("[periood]", { date: d("2026-10-15"), intervalMonths: 3, locale: "et" })).toBe("01.10.2026–31.12.2026");
    expect(fillPlaceholders("[kuu]", { date: d("2026-12-01"), intervalMonths: 1, locale: "ru" })).toBe("декабрь");
  });
});

describe("viivis", () => {
  it("päevad tähtajast arvestuse lõpuni", () => {
    // 1000 € × 0,05% × 10 päeva = 5 €
    const r = lateInterest({ amount: "1000", dueDate: d("2026-09-30"), payments: [], to: d("2026-10-10"), ratePct: "0.05" });
    expect(r.days).toBe(10);
    expect(r.amount.toFixed(2)).toBe("5.00");
  });

  it("osamakse vähendab võlga makse järgmisest päevast", () => {
    // 01.10–05.10 (5 p) 1000 €, 06.10–10.10 (5 p) 400 € → 2,50 + 1,00
    const r = lateInterest({
      amount: "1000",
      dueDate: d("2026-09-30"),
      payments: [{ date: d("2026-10-05"), amount: "600" }],
      to: d("2026-10-10"),
      ratePct: "0.05",
    });
    expect(r.segments.map((s) => [toISODate(s.from), toISODate(s.to), s.days, s.balance.toFixed(2)])).toEqual([
      ["2026-10-01", "2026-10-05", 5, "1000.00"],
      ["2026-10-06", "2026-10-10", 5, "400.00"],
    ]);
    expect(r.amount.toFixed(2)).toBe("3.50");
  });

  it("täielik tasumine lõpetab viivise; enne tähtaega tasutu ei too viivist", () => {
    const paid = lateInterest({
      amount: "200",
      dueDate: d("2026-09-30"),
      payments: [{ date: d("2026-10-03"), amount: "200" }],
      to: d("2026-10-31"),
      ratePct: "0.1",
    });
    expect(paid.days).toBe(3);
    expect(paid.amount.toFixed(2)).toBe("0.60");
    const early = lateInterest({ amount: "200", dueDate: d("2026-09-30"), payments: [{ date: d("2026-09-20"), amount: "200" }], to: d("2026-10-31"), ratePct: "0.1" });
    expect(early.amount.toFixed(2)).toBe("0.00");
  });

  it("jätkab eelmise viivisearve lõpust", () => {
    const r = lateInterest({ amount: "1000", dueDate: d("2026-09-30"), payments: [], from: d("2026-10-06"), to: d("2026-10-10"), ratePct: "0.05" });
    expect(r.days).toBe(5);
    expect(r.amount.toFixed(2)).toBe("2.50");
    const none = lateInterest({ amount: "1000", dueDate: d("2026-09-30"), payments: [], from: d("2026-10-11"), to: d("2026-10-10"), ratePct: "0.05" });
    expect(none.amount.toFixed(2)).toBe("0.00");
  });
});

describe("IBAN veateade", async () => {
  const { ibanIssue } = await import("@/lib/iban");
  it("eristab pikkuse, kuju ja kontrollsumma vea", () => {
    expect(ibanIssue("EE95 2200 2210 2916 8472")).toBeNull();
    // Pangakood „22“ puudu → 18 märki
    expect(ibanIssue("EE9500221029168472")).toBe("ibanLength");
    expect(ibanIssue("EE952200221029168473")).toBe("iban");
    expect(ibanIssue("1234")).toBe("ibanFormat");
    expect(ibanIssue("FI2112345600000785")).toBeNull();
  });
});
