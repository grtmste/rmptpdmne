import { describe, expect, it } from "vitest";
import { allocate, dec, formatMoney, parseMoneyInput, roundMoney, sum, toMoneyString } from "@/lib/money";

describe("roundMoney – aritmeetiline ümardus", () => {
  it.each([
    ["0.125", "0.13"],
    ["0.135", "0.14"],
    ["0.124", "0.12"],
    ["-0.125", "-0.13"],
    ["2.675", "2.68"], // float annaks 2.67
    ["1.005", "1.01"], // float annaks 1.00
    ["0", "0.00"],
  ])("%s → %s", (input, expected) => {
    expect(toMoneyString(input)).toBe(expected);
  });

  it("ei kaota täpsust suurte summade juures", () => {
    expect(toMoneyString("9999999999999999.995")).toBe("10000000000000000.00");
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
  });

  it("aktsepteerib Prisma Decimal-sarnaseid objekte", () => {
    expect(roundMoney({ toString: () => "12.345" }).toFixed(2)).toBe("12.35");
  });

  it("keeldub NaN ja Infinity väärtustest", () => {
    expect(() => dec(Number.NaN)).toThrow();
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("allocate", () => {
  it("jaotab summa nii, et osade summa on täpselt algne", () => {
    const parts = allocate("100.00", [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(sum(parts).toFixed(2)).toBe("100.00");
  });

  it("töötab negatiivse summaga", () => {
    const parts = allocate("-10.00", [1, 2]);
    expect(sum(parts).toFixed(2)).toBe("-10.00");
    expect(parts.map((p) => p.toFixed(2))).toEqual(["-3.33", "-6.67"]);
  });

  it("proportsionaalne kaalude järgi", () => {
    const parts = allocate("24.00", ["100", "20"]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["20.00", "4.00"]);
  });

  it("viskab vea nullkaalude korral", () => {
    expect(() => allocate("10", [0, 0])).toThrow();
  });
});

describe("formatMoney", () => {
  it("eesti vormingus tühik ja koma", () => {
    expect(formatMoney("1234567.5", "et")).toBe("1 234 567,50");
    expect(formatMoney("-1234.5", "et", { currency: "EUR" })).toBe("-1 234,50 EUR");
  });
  it("inglise vormingus koma ja punkt", () => {
    expect(formatMoney("1234567.5", "en")).toBe("1,234,567.50");
  });
});

describe("parseMoneyInput", () => {
  it.each([
    ["1 234,50", "1234.5"],
    ["1234.5", "1234.5"],
    ["1.234,50", "1234.5"],
    ["1,234.50", "1234.5"],
    ["-12,3", "-12.3"],
    ["12,5", "12.5"],
  ])("%s → %s", (input, expected) => {
    expect(parseMoneyInput(input)?.toString()).toBe(expected);
  });

  it.each(["", "abc", "1,2,3", "1..2"])("vigane sisend %s → null", (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });
});
