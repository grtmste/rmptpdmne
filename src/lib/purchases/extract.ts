import { isValidIban, normalizeIban } from "@/lib/iban";

/**
 * Ostuarve andmete tuvastamine dokumendi tekstist (tekstiga PDF; skaneeritud pildi korral
 * teksti pole ja tuvastus jääb tühjaks). Reeglid on keelte kaupa (et, en, fi, ru) siltide järgi;
 * kõik tulemused on ettepanekud, mille kasutaja üle vaatab.
 */

export type Extracted = {
  invoiceNumber: string | null;
  date: string | null;
  dueDate: string | null;
  referenceNumber: string | null;
  /** Summad kujul "1234.56" */
  total: string | null;
  vat: string | null;
  net: string | null;
  regCodes: string[];
  vatNumbers: string[];
  ibans: string[];
  currency: string | null;
};

const DATE = String.raw`(\d{1,2})[./](\d{1,2})[./](\d{2,4})|(\d{4})-(\d{2})-(\d{2})`;
const AMOUNT = String.raw`-?\d{1,3}(?:[  .,]\d{3})*(?:[.,]\d{1,2})|-?\d+(?:[.,]\d{1,2})?`;

function toIsoDate(m: RegExpMatchArray): string | null {
  let y: number, mo: number, d: number;
  if (m[4]) [y, mo, d] = [Number(m[4]), Number(m[5]), Number(m[6])];
  else {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "1 234,56" / "1.234,56" / "1,234.56" / "1234.5" → "1234.56" */
export function parseAmount(raw: string): string | null {
  let s = raw.replace(/[\s ]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decIdx = Math.max(lastComma, lastDot);
  // Viimane eraldaja on kümnendkoht ainult siis, kui sellele järgneb 1–2 numbrit
  if (decIdx >= 0 && s.length - decIdx - 1 <= 2) {
    const intPart = s.slice(0, decIdx).replace(/[.,]/g, "");
    s = `${intPart}.${s.slice(decIdx + 1)}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}


/** Sildi järel samal või järgmisel real olev väärtus. */
function afterLabel(lines: string[], label: RegExp, value: RegExp): RegExpMatchArray | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const lm = label.exec(l);
    if (!lm) continue;
    const rest = l.slice(lm.index + lm[0].length);
    const m = value.exec(rest) ?? (lines[i + 1] ? value.exec(lines[i + 1]!) : null);
    if (m) return m;
  }
  return null;
}

function lastAmountAfter(lines: string[], label: RegExp): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    const lm = label.exec(l);
    if (!lm) continue;
    const rest = l.slice(lm.index + lm[0].length);
    const all = [...rest.matchAll(new RegExp(AMOUNT, "g"))].map((m) => m[0]).filter((a) => /[.,]\d{2}$/.test(a) || /^\d+$/.test(a));
    const pick = all.at(-1) ?? (lines[i + 1] ? [...lines[i + 1]!.matchAll(new RegExp(AMOUNT, "g"))].map((m) => m[0]).at(-1) : undefined);
    if (pick) return parseAmount(pick);
  }
  return null;
}

const L = {
  number: /(arve\s*(?:nr|number|no)|invoice\s*(?:no|number|nr|#)|laskun?\s*(?:nro|numero)|сч[её]т(?:-фактура)?\s*№?|№)\.?\s*[:#]?\s*/i,
  date: /(arve\s*kuupäev|kuupäev|invoice\s*date|date\s*of\s*issue|päiväys|laskun\s*päivämäärä|дата(?:\s*сч[её]та)?)\s*[:.]?\s*/i,
  due: /(maksetähtaeg|maksetähtpäev|tähtaeg|tasuda\s*hiljemalt|due\s*date|payment\s*due|eräpäivä|срок\s*оплаты)\s*[:.]?\s*/i,
  reference: /(viitenumber|viitenr|viide|reference\s*(?:no|number)?|viitenumero|viite|ссылочный\s*номер)\s*[:.]?\s*/i,
  payable: /(tasuda|tasumisele\s*kuulub|kokku\s*tasuda|amount\s*due|total\s*due|to\s*pay|maksettava|к\s*оплате)\b\s*[:.]?/i,
  total: /(summa\s*kokku|arve\s*summa|kokku\s*km-ga|kokku|total|yhteensä|итого|всего)\b\s*[:.]?/i,
  vat: /(käibemaks|km\s*\d{1,2}\s*%|km|vat|alv|ндс)\b[^\d\n]*?(?:\d{1,2}(?:[.,]\d+)?\s*%)?\s*[:.]?/i,
  net: /(summa\s*km-ta|kokku\s*km-ta|km-ta|maksustatav|subtotal|net\s*amount|net|veroton|без\s*ндс)\b\s*[:.]?/i,
  regCode: /(reg\.?\s*(?:kood|nr|code|no)|registrikood|äriregistri\s*kood|registry\s*code|y-tunnus|рег\.?\s*код)\s*[:.]?\s*(\d{7,8})/gi,
};

export function extractInvoiceData(text: string, exclude: { regCode?: string | null; vatNumber?: string | null; ibans?: string[] } = {}): Extracted {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const flat = lines.join("\n");
  const excludedIbans = new Set((exclude.ibans ?? []).map(normalizeIban));

  const number = afterLabel(lines, L.number, /([A-ZÕÄÖÜ0-9][A-ZÕÄÖÜ0-9\-/._]{0,29})/i);
  const invoiceNumber = number?.[1] && /\d/.test(number[1]) ? number[1] : null;
  const dateM = afterLabel(lines, L.date, new RegExp(DATE));
  const dueM = afterLabel(lines, L.due, new RegExp(DATE));
  const allDates = [...flat.matchAll(new RegExp(DATE, "g"))].map(toIsoDate).filter((d): d is string => Boolean(d));
  const ref = afterLabel(lines, L.reference, /(\d[\d ]{1,24}\d)/);

  const regCodes = [...new Set([...flat.matchAll(L.regCode)].map((m) => m[2]!))].filter((c) => c !== exclude.regCode);
  const vatNumbers = [...new Set([...flat.matchAll(/\b(EE\d{9}|[A-Z]{2}\d{8,12})\b/g)].map((m) => m[1]!))].filter(
    (v) => v !== exclude.vatNumber?.toUpperCase() && !isValidIban(v),
  );
  const ibans = [
    ...new Set(
      [...flat.matchAll(/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?)\b/g)]
        .map((m) => normalizeIban(m[1]!))
        .filter((i) => isValidIban(i) && !excludedIbans.has(i)),
    ),
  ];

  const payable = lastAmountAfter(lines, L.payable);
  const total = payable ?? lastAmountAfter(lines, L.total);
  const vat = lastAmountAfter(lines, L.vat);
  let net = lastAmountAfter(lines, L.net);
  if (!net && total && vat) net = (Number(total) - Number(vat)).toFixed(2);

  const currency = /\bEUR\b|€/.test(flat) ? "EUR" : /\bUSD\b|\$/.test(flat) ? "USD" : /\bSEK\b/.test(flat) ? "SEK" : null;
  return {
    invoiceNumber,
    date: (dateM && toIsoDate(dateM)) ?? allDates[0] ?? null,
    dueDate: (dueM && toIsoDate(dueM)) ?? (allDates.length > 1 ? [...allDates].sort().at(-1)! : null),
    referenceNumber: ref?.[1]?.replace(/ /g, "") ?? null,
    total,
    vat,
    net,
    regCodes,
    vatNumbers,
    ibans,
    currency,
  };
}

/** Käibemaksu määr summadest (24/22/13/9/5/0), kui see on lähedal. */
export function guessVatPct(net: string | null, vat: string | null): number | null {
  if (!net || !vat || Number(net) === 0) return null;
  const pct = (Number(vat) / Number(net)) * 100;
  const known = [24, 22, 20, 13, 9, 5, 0];
  const best = known.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
  return Math.abs(best - pct) < 0.6 ? best : null;
}
