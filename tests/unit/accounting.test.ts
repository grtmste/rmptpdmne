import { describe, expect, it } from "vitest";
import { addMonths, monthSpan, parseISODate, toISODate } from "@/lib/accounting/dates";
import { deductibleVat, resolveVatRate, validateVatPeriods, vatAmount, vatFromGross } from "@/lib/accounting/vat";
import { nextFiscalYear, periodState, validateFiscalYear } from "@/lib/accounting/fiscal";
import { formatDocumentNumber, isValidReferenceNumber, referenceNumber } from "@/lib/accounting/numbering";
import { accountTypeFromCode, entryTotals, naturalBalance, validateEntryLines } from "@/lib/accounting/ledger";
import { BUSINESS_CHART, VAT_TEMPLATES } from "@/lib/accounting/templates";
import { findReportLine, reportLinesForType } from "@/lib/accounting/report-lines";

const d = (s: string) => parseISODate(s)!;

describe("kuupäevad", () => {
  it("parseISODate keeldub olematust kuupäevast", () => {
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("26-01-01")).toBeNull();
    expect(toISODate(d("2028-02-29"))).toBe("2028-02-29");
  });
  it("addMonths jääb kuu viimasele päevale", () => {
    expect(toISODate(addMonths(d("2026-01-31"), 1))).toBe("2026-02-28");
  });
  it("monthSpan", () => {
    expect(monthSpan(d("2026-01-01"), d("2026-12-31"))).toBe(12);
    expect(monthSpan(d("2026-07-01"), d("2027-12-31"))).toBe(18);
  });
});

describe("käibemaksumäär kuupäeva järgi", () => {
  const standard = VAT_TEMPLATES.find((v) => v.code === "KM")!.periods.map((p) => ({
    rate: p.rate,
    validFrom: d(p.validFrom),
    validTo: p.validTo ? d(p.validTo) : null,
  }));

  it.each([
    ["2023-12-31", "20"],
    ["2024-01-01", "22"],
    ["2025-06-30", "22"],
    ["2025-07-01", "24"],
    ["2030-01-01", "24"],
  ])("%s → %s%%", (date, rate) => {
    expect(resolveVatRate(standard, d(date))?.toString()).toBe(rate);
  });

  it("enne esimest perioodi määra pole", () => {
    expect(resolveVatRate(standard, d("2000-01-01"))).toBeNull();
  });

  it("mallide perioodid on kõik korrektsed", () => {
    for (const v of VAT_TEMPLATES) {
      const periods = v.periods.map((p) => ({ rate: p.rate, validFrom: d(p.validFrom), validTo: p.validTo ? d(p.validTo) : null }));
      expect(validateVatPeriods(periods), v.code).toBeNull();
    }
  });

  it("kattuvad perioodid on viga", () => {
    expect(
      validateVatPeriods([
        { rate: "22", validFrom: d("2024-01-01"), validTo: null },
        { rate: "24", validFrom: d("2025-07-01"), validTo: null },
      ]),
    ).toBe("overlap");
    expect(validateVatPeriods([{ rate: "22", validFrom: d("2024-02-01"), validTo: d("2024-01-01") }])).toBe("invalidRange");
    expect(validateVatPeriods([{ rate: "-1", validFrom: d("2024-01-01"), validTo: null }])).toBe("negativeRate");
    expect(validateVatPeriods([])).toBe("empty");
  });

  it("käibemaksu summad", () => {
    expect(vatAmount("100.00", "24").toFixed(2)).toBe("24.00");
    expect(vatAmount("10.05", "22").toFixed(2)).toBe("2.21"); // 2.211
    expect(vatAmount("0.125", "100").toFixed(2)).toBe("0.13");
    expect(vatFromGross("124.00", "24").toFixed(2)).toBe("24.00");
    expect(vatFromGross("10.00", "22").toFixed(2)).toBe("1.80"); // 1.8032…
    expect(deductibleVat("24.01", "50").toFixed(2)).toBe("12.01"); // 12.005 → 12.01
  });
});

describe("majandusaastad", () => {
  const y2025 = { id: "a", startDate: d("2025-01-01"), endDate: d("2025-12-31") };

  it("kattuv aasta on viga", () => {
    expect(validateFiscalYear({ startDate: d("2025-07-01"), endDate: d("2026-06-30") }, [y2025])).toBe("overlap");
    expect(validateFiscalYear({ startDate: d("2026-01-01"), endDate: d("2026-12-31") }, [y2025])).toBeNull();
  });

  it("üle 18 kuu on viga, 18 kuud on lubatud", () => {
    expect(validateFiscalYear({ startDate: d("2026-07-01"), endDate: d("2027-12-31") }, [])).toBeNull();
    expect(validateFiscalYear({ startDate: d("2026-06-01"), endDate: d("2027-12-31") }, [])).toBe("tooLong");
    expect(validateFiscalYear({ startDate: d("2026-02-01"), endDate: d("2026-01-01") }, [])).toBe("invalidRange");
  });

  it("aasta muutmisel ei loeta iseennast kattuvaks", () => {
    expect(validateFiscalYear({ ...y2025, endDate: d("2025-12-31") }, [y2025])).toBeNull();
  });

  it("järgmine aasta", () => {
    const n = nextFiscalYear([y2025, { startDate: d("2024-01-01"), endDate: d("2024-12-31") }])!;
    expect([toISODate(n.startDate), toISODate(n.endDate)]).toEqual(["2026-01-01", "2026-12-31"]);
    const odd = nextFiscalYear([{ startDate: d("2025-07-01"), endDate: d("2026-06-30") }])!;
    expect([toISODate(odd.startDate), toISODate(odd.endDate)]).toEqual(["2026-07-01", "2027-06-30"]);
  });

  it("perioodi olek", () => {
    const years = [y2025, { startDate: d("2024-01-01"), endDate: d("2024-12-31"), closedAt: new Date() }];
    expect(periodState(d("2025-05-01"), years, null)).toBe("open");
    expect(periodState(d("2024-05-01"), years, null)).toBe("closedYear");
    expect(periodState(d("2025-03-31"), years, d("2025-03-31"))).toBe("locked");
    expect(periodState(d("2025-04-01"), years, d("2025-03-31"))).toBe("open");
    expect(periodState(d("2027-01-01"), years, null)).toBe("noFiscalYear");
  });
});

describe("numeratsioon ja viitenumber", () => {
  it("dokumendi numbri vormingud", () => {
    expect(formatDocumentNumber({ prefix: "", suffix: "", yearBased: false, padding: 0 }, 1001, 2026)).toBe("1001");
    expect(formatDocumentNumber({ prefix: "PR-", suffix: "", yearBased: false, padding: 0 }, 15, 2026)).toBe("PR-15");
    expect(formatDocumentNumber({ prefix: "", suffix: "", yearBased: true, padding: 0 }, 7, 2026)).toBe("2026/7");
    expect(formatDocumentNumber({ prefix: "K-", suffix: "/A", yearBased: false, padding: 4 }, 3, 2026)).toBe("K-0003/A");
  });

  it.each([
    ["123", "1232"],
    ["1234", "12344"],
    ["12345", "123453"],
    ["1001", "10016"],
  ])("viitenumber %s → %s", (base, ref) => {
    expect(referenceNumber(base)).toBe(ref);
    expect(isValidReferenceNumber(ref)).toBe(true);
  });

  it("vigane viitenumber", () => {
    expect(isValidReferenceNumber("123454")).toBe(false);
    expect(isValidReferenceNumber("1")).toBe(false);
    expect(() => referenceNumber("")).toThrow();
  });
});

describe("kanded", () => {
  it("tasakaalus kanne on korras", () => {
    expect(
      validateEntryLines([
        { accountId: "a", debit: "100.00" },
        { accountId: "b", credit: "60.00" },
        { accountId: "c", credit: "40" },
      ]),
    ).toBeNull();
  });

  it("vead", () => {
    expect(validateEntryLines([])).toEqual({ code: "noLines" });
    expect(validateEntryLines([{ accountId: "a", debit: 1, credit: 1 }])).toEqual({ code: "lineBothSides", index: 0 });
    expect(validateEntryLines([{ accountId: "a" }])).toEqual({ code: "lineEmpty", index: 0 });
    expect(validateEntryLines([{ accountId: "a", debit: "-5" }])).toEqual({ code: "negativeAmount", index: 0 });
    expect(validateEntryLines([{ accountId: "a", debit: "1.005" }])).toEqual({ code: "tooManyDecimals", index: 0 });
    expect(
      validateEntryLines([
        { accountId: "a", debit: "100" },
        { accountId: "b", credit: "99.99" },
      ]),
    ).toEqual({ code: "unbalanced", debit: "100.00", credit: "99.99" });
  });

  it("summad ja saldo märk", () => {
    const t = entryTotals([{ accountId: "a", debit: "0.1" }, { accountId: "b", debit: "0.2" }, { accountId: "c", credit: "0.3" }]);
    expect(t.difference.isZero()).toBe(true);
    expect(naturalBalance("ASSET", 100, 30).toString()).toBe("70");
    expect(naturalBalance("LIABILITY", 30, 100).toString()).toBe("70");
    expect(naturalBalance("INCOME", 0, 50).toString()).toBe("50");
  });

  it("konto tüüp koodist", () => {
    expect(accountTypeFromCode("1200")).toBe("ASSET");
    expect(accountTypeFromCode("2110")).toBe("LIABILITY");
    expect(accountTypeFromCode("3000")).toBe("INCOME");
    expect(accountTypeFromCode("4190")).toBe("EXPENSE");
    expect(accountTypeFromCode("x")).toBeNull();
  });
});

describe("kontoplaani mall", () => {
  it("koodid on unikaalsed ja read sobivad konto tüübiga", () => {
    const codes = BUSINESS_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of BUSINESS_CHART) {
      const line = findReportLine(a.reportLine);
      expect(line, a.code).toBeDefined();
      expect(reportLinesForType(a.type).map((l) => l.code), a.code).toContain(a.reportLine);
    }
  });

  it("iga süsteemne roll on täpselt ühel kontol", () => {
    const roles = BUSINESS_CHART.flatMap((a) => (a.role ? [a.role] : []));
    expect(new Set(roles).size).toBe(roles.length);
    expect(roles).toContain("RECEIVABLES");
    expect(roles).toContain("CURRENT_YEAR_PROFIT");
    expect(roles).toContain("RETAINED_EARNINGS");
  });

  it("kontode käibemaksud ja KM kontod on mallis olemas", () => {
    const vatCodes = new Set(VAT_TEMPLATES.map((v) => v.code));
    const accountCodes = new Set(BUSINESS_CHART.map((a) => a.code));
    for (const a of BUSINESS_CHART) if (a.vat) expect(vatCodes.has(a.vat), a.code).toBe(true);
    for (const v of VAT_TEMPLATES) {
      if (v.salesAccount) expect(accountCodes.has(v.salesAccount)).toBe(true);
      if (v.purchaseAccount) expect(accountCodes.has(v.purchaseAccount)).toBe(true);
    }
  });
});
