import { describe, expect, it } from "vitest";
import { parseOpeningCsv } from "@/app/(app)/c/[companyId]/settings/opening-balances/parse-csv";

describe("algsaldode CSV", () => {
  it("loeb semikooloniga eesti vormingus faili", () => {
    const res = parseOpeningCsv("﻿Konto;Deebet;Kreedit\n1020;1 250,50;\n2900;;2500\n2950;;\n1000;1249,50;\n");
    expect(res).toEqual({
      ok: true,
      rows: [
        { code: "1020", debit: "1250.50", credit: null },
        { code: "2900", debit: null, credit: "2500.00" },
        { code: "1000", debit: "1249.50", credit: null },
      ],
    });
  });

  it("ingliskeelne päis, koma eraldaja ja jutumärgid", () => {
    const res = parseOpeningCsv('Credit,Account,Debit\n"1,000.00",2110,\n,1200,"1,000.00"\n');
    expect(res).toEqual({
      ok: true,
      rows: [
        { code: "2110", debit: null, credit: "1000.00" },
        { code: "1200", debit: "1000.00", credit: null },
      ],
    });
  });

  it("vead", () => {
    expect(parseOpeningCsv("")).toEqual({ ok: false, error: "empty" });
    expect(parseOpeningCsv("a;b\n1;2")).toEqual({ ok: false, error: "header" });
    expect(parseOpeningCsv("Konto;Deebet\n1000;abc")).toEqual({ ok: false, error: "amount" });
  });
});
