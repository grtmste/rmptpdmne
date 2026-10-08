import { describe, expect, it } from "vitest";
import et from "../../messages/et.json";
import en from "../../messages/en.json";
import fi from "../../messages/fi.json";
import ru from "../../messages/ru.json";
import { ALL_GROUPS, QUICK_ACTIONS, flattenNavigation } from "@/lib/navigation";
import { MODULES, LEVELS, COMPANY_ROLES } from "@/lib/permissions";
import { negotiateLocale } from "@/i18n/config";

type Tree = { [k: string]: string | Tree };

function keys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

function get(tree: Tree, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree);
}

describe("tõlkefailid", () => {
  const base = keys(et as Tree).sort();

  it.each([
    ["en", en],
    ["fi", fi],
    ["ru", ru],
  ])("%s sisaldab täpselt samu võtmeid kui et", (_name, messages) => {
    expect(keys(messages as Tree).sort()).toEqual(base);
  });

  it("igal menüüpunktil, grupil ja kiirtoimingul on tõlge", () => {
    for (const g of ALL_GROUPS) expect(get(et as Tree, `nav.groups.${g.id}`), g.id).toBeTypeOf("string");
    for (const i of flattenNavigation()) expect(get(et as Tree, `nav.items.${i.id}`), i.id).toBeTypeOf("string");
    for (const g of ALL_GROUPS)
      for (const s of g.sections) if (s.label) expect(get(et as Tree, `nav.sections.${s.label}`)).toBeTypeOf("string");
    for (const a of QUICK_ACTIONS) expect(get(et as Tree, `nav.quick.${a.id}`), a.id).toBeTypeOf("string");
  });

  it("rollidel, moodulitel ja tasemetel on tõlge", () => {
    for (const r of COMPANY_ROLES) {
      expect(get(et as Tree, `roles.${r}`)).toBeTypeOf("string");
      expect(get(et as Tree, `roles.descriptions.${r}`)).toBeTypeOf("string");
    }
    for (const m of MODULES) expect(get(et as Tree, `permissions.modules.${m}`)).toBeTypeOf("string");
    for (const l of LEVELS) expect(get(et as Tree, `permissions.levels.${l}`)).toBeTypeOf("string");
  });
});

describe("keele valik", () => {
  it("valib brauseri eelistuse järgi toetatud keele", () => {
    expect(negotiateLocale("fi-FI,fi;q=0.9,en;q=0.8")).toBe("fi");
    expect(negotiateLocale("de-DE,ru;q=0.5")).toBe("ru");
    expect(negotiateLocale("de-DE")).toBe("et");
    expect(negotiateLocale(null)).toBe("et");
  });
});

describe("faasi 1 tõlked", () => {
  it("aruande read, KM liigid, dokumenditüübid ja pearaamatu vead on tõlgitud", async () => {
    const { REPORT_LINES } = await import("@/lib/accounting/report-lines");
    for (const l of REPORT_LINES) expect(get(et as Tree, `reportLines.${l.code}`), l.code).toBeTypeOf("string");
    for (const k of ["TAXABLE", "ZERO_EXPORT", "ZERO_EU_GOODS", "EU_SERVICES", "EXEMPT", "REVERSE_CHARGE", "NOT_TAXABLE"]) {
      expect(get(et as Tree, `vat.kinds.${k}`)).toBeTypeOf("string");
      expect(get(et as Tree, `vat.kindHints.${k}`)).toBeTypeOf("string");
    }
    const { DEFAULT_NUMBER_SERIES } = await import("@/lib/accounting/templates");
    for (const s of DEFAULT_NUMBER_SERIES) expect(get(et as Tree, `series.types.${s.documentType}`)).toBeTypeOf("string");
    const ledgerCodes = [
      "noLines", "lineBothSides", "lineEmpty", "negativeAmount", "tooManyDecimals", "unbalanced", "accountNotFound",
      "accountInactive", "accountNotPostable", "currentYearProfitAccount", "departmentRequired", "departmentNotFound",
      "dimensionRequired", "dimensionValueNotFound", "dimensionValueEnded", "duplicateDimension", "vatRateNotFound",
      "locked", "closedYear", "noFiscalYear",
    ];
    for (const c of ledgerCodes) expect(get(et as Tree, `errors.ledger.${c}`), c).toBeTypeOf("string");
  });
});
