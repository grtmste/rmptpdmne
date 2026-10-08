import type { DecimalInput } from "./money";
import { roundMoney } from "./money";

/**
 * CSV Exceli jaoks: semikoolon eraldajaks, UTF-8 BOM (täpitähed avanevad õigesti),
 * eesti/soome/vene keeles kümnenderaldaja koma.
 */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

export function csvAmount(value: DecimalInput, locale: string): string {
  const s = roundMoney(value).toFixed(2);
  return locale === "en" ? s : s.replace(".", ",");
}
