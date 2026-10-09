import type Decimal from "decimal.js";
import { dec, roundMoney } from "@/lib/money";

/**
 * Käibedeklaratsioon (KMD) ja selle lisa (KMD INF) pearaamatu kannetest.
 *
 * Allikas on ainult kanderead, millel on KM kood ja KM summa (arvete tulu- ja kuluread ning
 * käsitsi kannete KM-iga read). Sisendkäibemaks (rida 5) võetakse sisendkäibemaksu kontode
 * käibest, nii et ka käsitsi korrigeerimised jõuavad deklaratsiooni.
 *
 * NB! Ridade numeratsioon järgib KMD vormi, mis kehtib alates 01.07.2025 (rida 1 = 24%,
 * 1¹ = 20%, 1² = 22%, 2 = 9%, 2¹ = 5%, 2² = 13%); varasemad perioodid vana vormi järgi
 * (rida 1 = 22%). Kõik vormipõhised seosed on selles failis – vormi muutumisel muuda siin.
 */

export type VatKind = "TAXABLE" | "ZERO_EXPORT" | "ZERO_EU_GOODS" | "EU_SERVICES" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_TAXABLE" | "MARGIN";

export type KmdSourceLine = {
  entryId: string;
  source: string;
  sourceId: string | null;
  /** Müük või ost (vt `sideOf`) */
  side: "SALES" | "PURCHASE";
  kind: VatKind;
  /** KM koodi määr kande kuupäeval (pöördmaksustamise koodidel sageli 0) */
  ratePct: Decimal;
  /** Standardmäär kande kuupäeval (pöördmaksustamise arvestamiseks) */
  standardPct: Decimal;
  deductiblePct: Decimal;
  debit: Decimal;
  credit: Decimal;
  /** Rea KM summa (alati positiivne, märk tuleb rea poolest) */
  vatAmount: Decimal;
  /** Põhivara soetus (KMD rida 5.2) */
  fixedAsset?: boolean;
};

/** Müük või ost: dokumendi allika järgi, käsitsi kandel konto KM käibe tunnuse või tüübi järgi. */
export function sideOf(source: string, accountVatTurnover: string | null, accountType: string): "SALES" | "PURCHASE" {
  if (source === "SALES_INVOICE") return "SALES";
  if (source === "PURCHASE_INVOICE" || source === "EXPENSE_REPORT") return "PURCHASE";
  if (accountVatTurnover === "SALES") return "SALES";
  if (accountVatTurnover === "PURCHASE") return "PURCHASE";
  return accountType === "INCOME" ? "SALES" : "PURCHASE";
}

const NEW_FORM_FROM = Date.UTC(2025, 6, 1);

/** Määra rida KMD-l (null = tundmatu määr). */
export function rateLine(pct: Decimal, periodStart: Date): string | null {
  const key = pct.toFixed(2);
  const map: Record<string, string> =
    periodStart.getTime() >= NEW_FORM_FROM
      ? { "24.00": "1", "20.00": "1¹", "22.00": "1²", "9.00": "2", "5.00": "2¹", "13.00": "2²" }
      : { "22.00": "1", "20.00": "1¹", "9.00": "2", "5.00": "2¹", "13.00": "2²" };
  return map[key] ?? null;
}

/** Deklaratsiooni read vormi järjekorras. `rate` – määraga rida (summa = maksustatav väärtus). */
export const KMD_LINES: Array<{ code: string; rate?: string; total?: boolean }> = [
  { code: "1", rate: "24/22" },
  { code: "1¹", rate: "20" },
  { code: "1²", rate: "22" },
  { code: "2", rate: "9" },
  { code: "2¹", rate: "5" },
  { code: "2²", rate: "13" },
  { code: "3" },
  { code: "3.1" },
  { code: "3.1.1" },
  { code: "3.2" },
  { code: "3.2.1" },
  { code: "4", total: true },
  { code: "4¹" },
  { code: "5", total: true },
  { code: "5.1" },
  { code: "5.2" },
  { code: "5.3" },
  { code: "5.4" },
  { code: "6" },
  { code: "6.1" },
  { code: "7" },
  { code: "7.1" },
  { code: "8" },
  { code: "9" },
  { code: "10" },
  { code: "11" },
  { code: "12", total: true },
  { code: "13", total: true },
];

export type KmdResult = {
  lines: Map<string, Decimal>;
  /** Tundmatu määraga read (ei kajastunud määra real) */
  unknownRates: string[];
  hasSales: boolean;
  hasPurchases: boolean;
};

const signOf = (v: Decimal) => (v.isNegative() ? -1 : 1);

/** Ostu mahaarvatav KM rea KM summast. */
export function deductibleOf(vat: Decimal, deductiblePct: Decimal) {
  return roundMoney(vat.times(deductiblePct).dividedBy(100));
}

export function computeKmd(
  source: KmdSourceLine[],
  opts: { periodStart: Date; inputVat?: Decimal | null; adjustmentsPlus?: Decimal; adjustmentsMinus?: Decimal },
): KmdResult {
  const lines = new Map<string, Decimal>(KMD_LINES.map((l) => [l.code, dec(0)]));
  const add = (code: string, v: Decimal) => lines.set(code, lines.get(code)!.plus(v));
  const unknown = new Set<string>();
  let estimatedInput = dec(0);
  let hasSales = false;
  let hasPurchases = false;

  for (const l of source) {
    if (l.side === "SALES") {
      const base = l.credit.minus(l.debit);
      const vat = l.vatAmount.times(signOf(base));
      if (!base.isZero()) hasSales = true;
      switch (l.kind) {
        case "TAXABLE": {
          const line = rateLine(l.ratePct, opts.periodStart);
          if (line) add(line, base);
          else unknown.add(l.ratePct.toFixed(2));
          add("4", vat);
          break;
        }
        case "MARGIN": {
          // Maksustatav väärtus on kasuminorm ilma KM-ita (KM summa järgi)
          const pct = l.ratePct.isZero() ? l.standardPct : l.ratePct;
          const line = rateLine(pct, opts.periodStart);
          if (line && !pct.isZero()) add(line, roundMoney(vat.times(100).dividedBy(pct)));
          else unknown.add(pct.toFixed(2));
          add("4", vat);
          break;
        }
        case "ZERO_EXPORT":
          add("3", base);
          add("3.2", base);
          break;
        case "ZERO_EU_GOODS":
          add("3", base);
          add("3.1", base);
          add("3.1.1", base);
          break;
        case "EU_SERVICES":
          add("3", base);
          add("3.1", base);
          break;
        case "EXEMPT":
          add("8", base);
          break;
        case "REVERSE_CHARGE":
          add("9", base);
          break;
        default:
          break;
      }
    } else {
      const amount = l.debit.minus(l.credit);
      const sign = signOf(amount);
      const vat = l.vatAmount.times(sign);
      const deductible = deductibleOf(l.vatAmount, l.deductiblePct).times(sign);
      // Kulureal on mittemahaarvatav KM kulu sees – maksustatav väärtus on ilma selleta
      const base = amount.minus(vat.minus(deductible));
      if (!base.isZero()) hasPurchases = true;
      const reverse = l.kind === "EU_SERVICES" || l.kind === "ZERO_EU_GOODS" || l.kind === "REVERSE_CHARGE";
      if (reverse) {
        if (l.kind === "REVERSE_CHARGE") {
          add("7", base);
          add("7.1", base);
        } else {
          add("6", base);
          if (l.kind === "ZERO_EU_GOODS") add("6.1", base);
        }
        const pct = l.ratePct.isZero() ? l.standardPct : l.ratePct;
        const line = rateLine(pct, opts.periodStart);
        if (line) add(line, base);
        else unknown.add(pct.toFixed(2));
        add("4", vat);
      }
      if (l.kind === "TAXABLE" || reverse) {
        estimatedInput = estimatedInput.plus(deductible);
        if (l.fixedAsset) add("5.2", deductible);
        if (l.deductiblePct.greaterThan(0) && l.deductiblePct.lessThan(100)) add("5.4", deductible);
      }
    }
  }

  lines.set("5", opts.inputVat ?? estimatedInput);
  lines.set("10", opts.adjustmentsPlus ?? dec(0));
  lines.set("11", opts.adjustmentsMinus ?? dec(0));
  const payable = lines.get("4")!.plus(lines.get("4¹")!).minus(lines.get("5")!).plus(lines.get("10")!).minus(lines.get("11")!);
  lines.set("12", payable.isPositive() ? payable : dec(0));
  lines.set("13", payable.isNegative() ? payable.negated() : dec(0));
  return { lines, unknownRates: [...unknown], hasSales, hasPurchases };
}

// --- KMD INF ---------------------------------------------------------------

/** Tehingupartneri piirmäär (arvete summa ilma KM-ita perioodis). */
export const KMD_INF_THRESHOLD = 1000;

export type KmdInfDocument = {
  side: "SALES" | "PURCHASE";
  documentId: string;
  partnerRegCode: string | null;
  partnerName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  /** Kogu arve summa ilma KM-ita (EUR) */
  invoiceNet: Decimal;
  /** Kogu arve summa koos KM-iga (EUR) – ostuarve */
  invoiceGross: Decimal;
};

export type KmdInfLine = {
  partnerRegCode: string;
  partnerName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  invoiceSum: Decimal;
  /** A-osa: määr; B-osa: tühi */
  taxRate: string | null;
  /** A-osa: määraga maksustatav väärtus arvel; B-osa: arve summa koos KM-iga */
  sumForRate: Decimal;
  /** A-osa: määraga väärtus perioodis; B-osa: perioodis maha arvatud KM */
  sumInPeriod: Decimal;
  /** Erisuse kood (A: 01 – KMS § 41¹ pöördmaksustatav käive; B: 11 – osaline mahaarvamine, 12 – KMS § 41¹ soetus) */
  comment: string | null;
};

/**
 * KMD INF A- ja B-osa. `lines` – samad allikaread kui KMD-l koos dokumendi viitega;
 * kajastuvad maksustatavad (ja § 41¹ pöördmaksustatavad) arved partneritelt, kelle arvete summa
 * ilma KM-ita perioodis on vähemalt 1000 €. Registrikoodita partnerid (eraisikud) ei kajastu.
 */
export function computeKmdInf(
  lines: Array<KmdSourceLine & { documentId: string | null }>,
  documents: Map<string, KmdInfDocument>,
  periodStart: Date,
) {
  type Acc = { doc: KmdInfDocument; rates: Map<string, Decimal>; vatInPeriod: Decimal; comment: string | null; net: Decimal };
  const byDoc = new Map<string, Acc>();
  for (const l of lines) {
    if (!l.documentId) continue;
    const doc = documents.get(l.documentId);
    if (!doc || !doc.partnerRegCode) continue;
    const relevant = l.kind === "TAXABLE" || l.kind === "REVERSE_CHARGE";
    if (!relevant) continue;
    const acc = byDoc.get(l.documentId) ?? { doc, rates: new Map(), vatInPeriod: dec(0), comment: null, net: dec(0) };
    if (l.side === "SALES") {
      const base = l.credit.minus(l.debit);
      const rate = l.kind === "REVERSE_CHARGE" ? "0" : l.ratePct.toFixed(0);
      if (l.kind === "REVERSE_CHARGE") acc.comment = "01";
      else if (!rateLine(l.ratePct, periodStart)) continue;
      acc.rates.set(rate, (acc.rates.get(rate) ?? dec(0)).plus(base));
      acc.net = acc.net.plus(base);
    } else {
      const amount = l.debit.minus(l.credit);
      const sign = signOf(amount);
      const vat = l.vatAmount.times(sign);
      const deductible = deductibleOf(l.vatAmount, l.deductiblePct).times(sign);
      acc.net = acc.net.plus(amount.minus(vat.minus(deductible)));
      acc.vatInPeriod = acc.vatInPeriod.plus(deductible);
      if (l.kind === "REVERSE_CHARGE") acc.comment = "12";
      else if (l.deductiblePct.lessThan(100) && !acc.comment) acc.comment = "11";
    }
    byDoc.set(l.documentId, acc);
  }

  const partnerTotals = new Map<string, Decimal>();
  for (const a of byDoc.values()) {
    const key = `${a.doc.side}|${a.doc.partnerRegCode}`;
    partnerTotals.set(key, (partnerTotals.get(key) ?? dec(0)).plus(a.net));
  }
  const over = (a: Acc) => (partnerTotals.get(`${a.doc.side}|${a.doc.partnerRegCode}`) ?? dec(0)).abs().greaterThanOrEqualTo(KMD_INF_THRESHOLD);

  const partA: KmdInfLine[] = [];
  const partB: KmdInfLine[] = [];
  const docs = [...byDoc.values()].filter(over).sort(
    (x, y) => (x.doc.partnerName.localeCompare(y.doc.partnerName)) || x.doc.invoiceDate.getTime() - y.doc.invoiceDate.getTime() || x.doc.invoiceNumber.localeCompare(y.doc.invoiceNumber),
  );
  for (const a of docs) {
    const common = {
      partnerRegCode: a.doc.partnerRegCode!,
      partnerName: a.doc.partnerName,
      invoiceNumber: a.doc.invoiceNumber,
      invoiceDate: a.doc.invoiceDate,
    };
    if (a.doc.side === "SALES") {
      for (const [rate, amount] of a.rates) {
        partA.push({ ...common, invoiceSum: a.doc.invoiceNet, taxRate: rate, sumForRate: amount, sumInPeriod: amount, comment: a.comment });
      }
    } else {
      partB.push({ ...common, invoiceSum: a.doc.invoiceGross, taxRate: null, sumForRate: a.doc.invoiceGross, sumInPeriod: a.vatInPeriod, comment: a.comment });
    }
  }
  return { partA, partB };
}

// --- e-MTA XML ---------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amt = (v: Decimal) => roundMoney(v).toFixed(2);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Määra rea XML-element (nt rida 1 = transactions24 uue vormi järgi). */
function rateElement(code: string, periodStart: Date) {
  const newForm = periodStart.getTime() >= NEW_FORM_FROM;
  const rates: Record<string, string> = newForm
    ? { "1": "24", "1¹": "20", "1²": "22", "2": "9", "2¹": "5", "2²": "13" }
    : { "1": "22", "1¹": "20", "2": "9", "2¹": "5", "2²": "13" };
  return rates[code] ? `transactions${rates[code]}` : null;
}

const BODY_ELEMENTS: Array<[string, string]> = [
  ["3", "transactionsZeroVat"],
  ["3.1", "euSupplyInclGoodsAndServicesZeroVat"],
  ["3.1.1", "euSupplyGoodsZeroVat"],
  ["3.2", "exportZeroVat"],
  ["3.2.1", "salePassengersWithReturnVat"],
  ["4¹", "importVat"],
  ["5", "inputVatTotal"],
  ["5.1", "importVatInput"],
  ["5.2", "fixedAssetsVat"],
  ["5.3", "carsVat"],
  ["5.4", "carsPartialVat"],
  ["6", "euAcquisitionsGoodsAndServicesTotal"],
  ["6.1", "euAcquisitionsGoods"],
  ["7", "acquisitionOtherGoodsAndServicesTotal"],
  ["7.1", "acquisitionImmovablesAndScrapMetalAndGold"],
  ["8", "supplyExemptFromTax"],
  ["9", "supplySpecialArrangements"],
  ["10", "adjustmentsPlus"],
  ["11", "adjustmentsMinus"],
];

/**
 * Deklaratsioon e-MTA XML-impordi kujul (vatDeclaration). Struktuuri tuleb uue vormi
 * avaldamisel kontrollida e-MTA XSD vastu – elementide nimed on koondatud siia.
 */
export function buildKmdXml(input: {
  regCode: string;
  year: number;
  month: number;
  periodStart: Date;
  kmd: KmdResult;
  partA: KmdInfLine[];
  partB: KmdInfLine[];
}) {
  const x: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<vatDeclaration>"];
  x.push(`  <taxPayerRegCode>${esc(input.regCode)}</taxPayerRegCode>`);
  x.push(`  <year>${input.year}</year>`, `  <month>${input.month}</month>`);
  x.push("  <declarationType>1</declarationType>", "  <version>KMD4</version>", "  <declarationBody>");
  x.push(`    <noSales>${!input.kmd.hasSales}</noSales>`, `    <noPurchases>${!input.kmd.hasPurchases}</noPurchases>`);
  x.push("    <sumPerPartnerSales>false</sumPerPartnerSales>", "    <sumPerPartnerPurchases>false</sumPerPartnerPurchases>");
  for (const l of KMD_LINES) {
    const el = rateElement(l.code, input.periodStart);
    const v = input.kmd.lines.get(l.code)!;
    if (el && !v.isZero()) x.push(`    <${el}>${amt(v)}</${el}>`);
  }
  for (const [code, el] of BODY_ELEMENTS) {
    const v = input.kmd.lines.get(code)!;
    if (!v.isZero()) x.push(`    <${el}>${amt(v)}</${el}>`);
  }
  x.push("  </declarationBody>");
  if (input.partA.length) {
    x.push("  <salesAnnex>");
    for (const l of input.partA) {
      x.push(
        "    <saleLine>",
        `      <buyerRegCode>${esc(l.partnerRegCode)}</buyerRegCode>`,
        `      <buyerName>${esc(l.partnerName)}</buyerName>`,
        `      <invoiceNumber>${esc(l.invoiceNumber)}</invoiceNumber>`,
        `      <invoiceDate>${iso(l.invoiceDate)}</invoiceDate>`,
        `      <invoiceSum>${amt(l.invoiceSum)}</invoiceSum>`,
        `      <taxRate>${esc(l.taxRate ?? "")}</taxRate>`,
        `      <invoiceSumForRate>${amt(l.sumForRate)}</invoiceSumForRate>`,
        `      <sumForRateInPeriod>${amt(l.sumInPeriod)}</sumForRateInPeriod>`,
        ...(l.comment ? [`      <comments>${l.comment}</comments>`] : []),
        "    </saleLine>",
      );
    }
    x.push("  </salesAnnex>");
  }
  if (input.partB.length) {
    x.push("  <purchasesAnnex>");
    for (const l of input.partB) {
      x.push(
        "    <purchaseLine>",
        `      <sellerRegCode>${esc(l.partnerRegCode)}</sellerRegCode>`,
        `      <sellerName>${esc(l.partnerName)}</sellerName>`,
        `      <invoiceNumber>${esc(l.invoiceNumber)}</invoiceNumber>`,
        `      <invoiceDate>${iso(l.invoiceDate)}</invoiceDate>`,
        `      <invoiceSumVat>${amt(l.invoiceSum)}</invoiceSumVat>`,
        `      <vatInPeriod>${amt(l.sumInPeriod)}</vatInPeriod>`,
        ...(l.comment ? [`      <comments>${l.comment}</comments>`] : []),
        "    </purchaseLine>",
      );
    }
    x.push("  </purchasesAnnex>");
  }
  x.push("</vatDeclaration>", "");
  return x.join("\n");
}
