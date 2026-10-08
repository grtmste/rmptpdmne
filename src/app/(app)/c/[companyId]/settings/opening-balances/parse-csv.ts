import { parseMoneyInput } from "@/lib/money";

export type OpeningCsvRow = { code: string; debit: string | null; credit: string | null };
export type OpeningCsvResult = { ok: true; rows: OpeningCsvRow[] } | { ok: false; error: "empty" | "header" | "amount" };

const CODE_HEADERS = ["konto", "account", "tili", "счет", "счёт", "kood", "code"];
const DEBIT_HEADERS = ["deebet", "debit", "debet", "дебет"];
const CREDIT_HEADERS = ["kreedit", "credit", "kredit", "кредит"];

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * Algsaldode CSV: veerud Konto, Deebet, Kreedit (päis on kohustuslik, järjekord vaba).
 * Eraldaja tuvastatakse ise (semikoolon, koma või tabulaator). Summad võivad olla
 * eesti vormingus ("1 234,50").
 */
export function parseOpeningCsv(text: string): OpeningCsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { ok: false, error: "empty" };
  const head = lines[0]!;
  const delimiter = head.includes("\t") ? "\t" : head.includes(";") ? ";" : ",";
  const headers = splitLine(head, delimiter).map((h) => h.toLowerCase());
  const ci = headers.findIndex((h) => CODE_HEADERS.includes(h));
  const di = headers.findIndex((h) => DEBIT_HEADERS.includes(h));
  const ki = headers.findIndex((h) => CREDIT_HEADERS.includes(h));
  if (ci < 0 || (di < 0 && ki < 0)) return { ok: false, error: "header" };

  const rows: OpeningCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter);
    const code = cells[ci]?.trim();
    if (!code) continue;
    const amount = (i: number) => {
      const raw = i >= 0 ? (cells[i] ?? "") : "";
      if (raw === "") return null;
      const d = parseMoneyInput(raw);
      return d ? d.toFixed(2) : undefined;
    };
    const debit = amount(di);
    const credit = amount(ki);
    if (debit === undefined || credit === undefined) return { ok: false, error: "amount" };
    if (!debit && !credit) continue;
    rows.push({ code, debit, credit });
  }
  return { ok: true, rows };
}
