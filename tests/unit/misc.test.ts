import { describe, expect, it } from "vitest";
import { annualReportDeadline, daysUntil, easterSunday, isPublicHoliday, nextVatDeadline, nextWorkingDay } from "@/lib/deadlines";
import { todayLocal } from "@/lib/dates";
import { findNavItem } from "@/lib/navigation";
import { safeRedirect, vatNumberSchema } from "@/lib/validation";
import { switchTarget } from "@/components/shell/company-switcher";
import { diffRecords } from "@/lib/audit";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("KMD tähtaeg", () => {
  it("enne 20. kuupäeva on tähtaeg sama kuu 20.", () => {
    expect(nextVatDeadline(d("2026-10-07"))).toEqual({ period: "2026-09", dueDate: d("2026-10-20") });
  });
  it("tähtaja päeval kehtib veel sama tähtaeg", () => {
    expect(nextVatDeadline(d("2026-10-20")).period).toBe("2026-09");
  });
  it("pärast 20. kuupäeva on järgmise kuu tähtaeg", () => {
    expect(nextVatDeadline(d("2026-10-21"))).toEqual({ period: "2026-10", dueDate: d("2026-11-20") });
  });
  it("nädalavahetusel nihkub järgmisele tööpäevale", () => {
    // 20.09.2026 on pühapäev
    expect(nextVatDeadline(d("2026-09-10")).dueDate).toEqual(d("2026-09-21"));
    // 21.09 kehtib veel augusti periood
    expect(nextVatDeadline(d("2026-09-21")).period).toBe("2026-08");
  });
  it("riigipühad ja suur reede", () => {
    expect(easterSunday(2026)).toEqual(d("2026-04-05"));
    expect(easterSunday(2027)).toEqual(d("2027-03-28"));
    expect(isPublicHoliday(d("2026-04-03"))).toBe(true);
    expect(isPublicHoliday(d("2026-04-02"))).toBe(false);
    expect(isPublicHoliday(d("2026-02-24"))).toBe(true);
    // jaanipäev: 23. ja 24. juuni
    expect(nextWorkingDay(d("2026-06-23"))).toEqual(d("2026-06-25"));
  });
  it("majandusaasta aruande tähtaeg 6 kuud pärast aasta lõppu", () => {
    expect(annualReportDeadline(d("2025-12-31"))).toEqual(d("2026-06-30"));
    // 30.06.2029 on laupäev
    expect(annualReportDeadline(d("2028-12-31"))).toEqual(d("2029-07-02"));
    expect(annualReportDeadline(d("2026-06-30"))).toEqual(d("2026-12-31"));
  });
  it("aastavahetus", () => {
    expect(nextVatDeadline(d("2026-12-25"))).toEqual({ period: "2026-12", dueDate: d("2027-01-20") });
  });
  it("päevade arv", () => {
    expect(daysUntil(d("2026-10-07"), d("2026-10-20"))).toBe(13);
  });
  it("tänane kuupäev Eesti ajas", () => {
    // 22:30 UTC on Tallinnas juba järgmine päev (UTC+3 suveajal)
    expect(todayLocal(new Date("2026-07-01T22:30:00Z"))).toEqual(d("2026-07-02"));
  });
});

describe("navigatsioon", () => {
  it("leiab pikima vaste", () => {
    expect(findNavItem("/sales/invoices/abc123")?.id).toBe("sales.invoices");
    expect(findNavItem("/payments/statements")?.id).toBe("payments.statements");
    expect(findNavItem("/payments/xyz")?.id).toBe("payments.list");
    expect(findNavItem("/unknown")).toBeUndefined();
  });

  it("ettevõtte vahetamisel jääb samasse moodulisse, mitte dokumendile", () => {
    expect(switchTarget("/c/a/sales/invoices/123", "/c/a", "b")).toBe("/c/b/sales/invoices");
    expect(switchTarget("/c/a", "/c/a", "b")).toBe("/c/b");
    expect(switchTarget("/c/a/weird", "/c/a", "b")).toBe("/c/b");
  });
});

describe("valideerimine", () => {
  it("safeRedirect keelab välised aadressid", () => {
    expect(safeRedirect("/c/1")).toBe("/c/1");
    expect(safeRedirect("//evil.com")).toBe("/");
    expect(safeRedirect("https://evil.com")).toBe("/");
    expect(safeRedirect("/\\evil.com")).toBe("/");
    expect(safeRedirect(undefined, "/x")).toBe("/x");
  });

  it("KMKR number", () => {
    expect(vatNumberSchema.parse("ee 100 000 000")).toBe("EE100000000");
    expect(vatNumberSchema.parse("")).toBeNull();
    expect(vatNumberSchema.safeParse("123").success).toBe(false);
  });
});

describe("audit diff", () => {
  it("salvestab ainult muutunud väljad", () => {
    expect(diffRecords({ name: "A", regCode: "1" }, { name: "B", regCode: "1" })).toEqual({
      before: { name: "A" },
      after: { name: "B" },
    });
    expect(diffRecords({ name: "A" }, { name: "A" })).toBeNull();
  });
});

describe("CSV", () => {
  it("semikoolon, BOM, jutumärgid ja koma", async () => {
    const { toCsv, csvAmount } = await import("@/lib/csv");
    expect(toCsv([["a", 'b"c', "d;e"], [1, null, "x"]])).toBe('﻿a;"b""c";"d;e"\r\n1;;x\r\n');
    expect(csvAmount("1234.5", "et")).toBe("1234,50");
    expect(csvAmount("1234.5", "en")).toBe("1234.50");
  });
});

describe("IBAN", () => {
  it("kontrollsumma ja vormindus", async () => {
    const { isValidIban, formatIban, normalizeIban } = await import("@/lib/iban");
    expect(isValidIban("EE38 2200 2210 2014 5685")).toBe(true);
    expect(isValidIban("EE382200221020145684")).toBe(false);
    expect(isValidIban("FI2112345600000785")).toBe(true);
    expect(isValidIban("EE3822002210201456")).toBe(false);
    expect(normalizeIban("ee38 2200")).toBe("EE382200");
    expect(formatIban("EE382200221020145685")).toBe("EE38 2200 2210 2014 5685");
  });
});
