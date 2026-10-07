import Decimal from "decimal.js";

/**
 * Kõik rahaarvutused käivad läbi selle mooduli. Ära kasuta rahasummade jaoks `number`-it.
 *
 * Ümardusreegel: aritmeetiline (pool ülespoole, nullist eemale): 0,125 → 0,13; -0,125 → -0,13.
 * See vastab Eesti arvete ja käibemaksu tavapraktikale. Reegli muutmiseks muuda ainult
 * konstanti ROUNDING.
 */
export const ROUNDING = Decimal.ROUND_HALF_UP;

/** Rahasumma komakohtade arv (Prisma Decimal(18, 2)). */
export const MONEY_SCALE = 2;
/** Koguste komakohtade arv (Prisma Decimal(18, 4)). */
export const QUANTITY_SCALE = 4;
/** Valuutakursside komakohtade arv (Prisma Decimal(18, 6)). */
export const RATE_SCALE = 6;

// Oma Decimal klass, et globaalne seadistus ei mõjutaks teisi teeke.
export const Dec = Decimal.clone({ precision: 40, rounding: ROUNDING });
export type Dec = Decimal;

/** Väärtused, mida saab rahasummaks teisendada. Prisma Decimal on decimal.js ühilduv. */
export type DecimalInput = Decimal.Value | { toString(): string };

export function dec(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Dec(0);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`Vigane arv: ${value}`);
  }
  if (Decimal.isDecimal(value)) return new Dec(value as Decimal);
  if (typeof value === "string" || typeof value === "number") return new Dec(value);
  return new Dec(value.toString());
}

/** Ümardab rahasummaks (2 kohta). */
export function roundMoney(value: DecimalInput): Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, ROUNDING);
}

/** Ümardab koguseks (4 kohta). */
export function roundQuantity(value: DecimalInput): Decimal {
  return dec(value).toDecimalPlaces(QUANTITY_SCALE, ROUNDING);
}

/** Ümardab etteantud komakohtadeni sama reegliga. */
export function roundTo(value: DecimalInput, places: number): Decimal {
  return dec(value).toDecimalPlaces(places, ROUNDING);
}

export function sum(values: Iterable<DecimalInput>): Decimal {
  let total = new Dec(0);
  for (const v of values) total = total.plus(dec(v));
  return total;
}

export function isZero(value: DecimalInput): boolean {
  return dec(value).isZero();
}

export function eq(a: DecimalInput, b: DecimalInput): boolean {
  return dec(a).equals(dec(b));
}

/**
 * Jaotab summa osadeks proportsionaalselt kaaludega nii, et osade summa on täpselt
 * algne summa (ümardusjääk läheb suurima murdosaga osadele). Vajalik nt KM ja allahindluse
 * jaotamisel ridadele.
 */
export function allocate(total: DecimalInput, weights: DecimalInput[]): Decimal[] {
  const amount = roundMoney(total);
  if (weights.length === 0) return [];
  const w = weights.map((x) => dec(x));
  const weightSum = sum(w);
  if (weightSum.isZero()) {
    throw new RangeError("Kaalude summa ei tohi olla null");
  }
  const unit = new Dec(10).pow(-MONEY_SCALE);
  const raw = w.map((x) => amount.times(x).dividedBy(weightSum));
  const parts = raw.map((x) => x.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN));
  let remainder = amount.minus(sum(parts));
  const order = raw
    .map((x, i) => ({ i, frac: x.minus(parts[i]!).abs() }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const step = remainder.isNegative() ? unit.negated() : unit;
  for (let k = 0; !remainder.isZero(); k = (k + 1) % order.length) {
    const idx = order[k]!.i;
    parts[idx] = parts[idx]!.plus(step);
    remainder = remainder.minus(step);
  }
  return parts;
}

/** Summa andmebaasi/JSON-i jaoks: alati 2 komakohaga string, nt "1234.50". */
export function toMoneyString(value: DecimalInput): string {
  return roundMoney(value).toFixed(MONEY_SCALE);
}

/**
 * Vormindab summa kasutajale, nt et: "1 234,50", en: "1,234.50".
 * Vormindus käib stringina, et vältida float-teisendust suurte summade puhul.
 */
export function formatMoney(
  value: DecimalInput,
  locale = "et",
  options: { currency?: string; scale?: number } = {},
): string {
  const scale = options.scale ?? MONEY_SCALE;
  const fixed = roundTo(value, scale).toFixed(scale);
  const negative = fixed.startsWith("-");
  const [intPart, fracPart] = (negative ? fixed.slice(1) : fixed).split(".");
  const { group, decimal } = separators(locale);
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const number = (negative ? "-" : "") + grouped + (fracPart ? decimal + fracPart : "");
  return options.currency ? `${number} ${options.currency}` : number;
}

function separators(locale: string): { group: string; decimal: string } {
  // Kasutame Intl-i ainult eraldajate leidmiseks.
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === "group")?.value ?? " ";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ",";
  // Kitsas tühik (U+202F) ja tavaline tühik → tavaline tühik, et kopeerimine oleks lihtne.
  return { group: group.replace(/[  ]/g, " "), decimal };
}

/**
 * Loeb kasutaja sisestatud summa ("1 234,50", "1234.5", "-12,3") Decimaliks.
 * Tagastab null, kui sisend ei ole arv.
 */
export function parseMoneyInput(input: string): Decimal | null {
  const cleaned = input.trim().replace(/[\s  ]/g, "");
  if (cleaned === "") return null;
  // Kui on nii punkt kui koma, on viimane kümnenderaldaja.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const groupSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(groupSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return new Dec(normalized);
}
