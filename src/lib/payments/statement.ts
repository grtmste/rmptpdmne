import { XMLParser } from "fast-xml-parser";
import { dec } from "@/lib/money";
import { parseMoneyInput } from "@/lib/money";
import { normalizeIban } from "@/lib/iban";

/**
 * Pangaväljavõtte lugemine: ISO 20022 camt.053 (XML) ja Eesti pankade CSV.
 * Tulemuseks ühtne kirjete loend – märgiga summa (+ laekumine, − väljamakse).
 */

export type StatementEntry = {
  date: string; // YYYY-MM-DD
  amount: string; // märgiga, 2 komakohta
  currency: string;
  partyName: string | null;
  partyIban: string | null;
  referenceNumber: string | null;
  description: string | null;
  bankReference: string | null;
};

export type ParsedStatement = {
  externalId: string | null;
  iban: string | null;
  currency: string | null;
  fromDate: string | null;
  toDate: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  entries: StatementEntry[];
};

export class StatementParseError extends Error {
  constructor(public code: "invalidFile" | "noEntries") {
    super(code);
    this.name = "StatementParseError";
  }
}

const arr = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]).trim() || null;
  const s = String(v).trim();
  return s || null;
};
const dateOf = (v: unknown): string | null => {
  const node = v as Record<string, unknown> | undefined;
  const s = text(node?.Dt ?? node?.DtTm ?? v);
  return s ? s.slice(0, 10) : null;
};

export function parseCamt053(xml: string): ParsedStatement {
  let doc: Record<string, unknown>;
  try {
    doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, attributeNamePrefix: "@" }).parse(xml);
  } catch {
    throw new StatementParseError("invalidFile");
  }
  const root = (doc.Document as Record<string, unknown> | undefined)?.BkToCstmrStmt as Record<string, unknown> | undefined;
  if (!root) throw new StatementParseError("invalidFile");
  const stmt = arr(root.Stmt as Record<string, unknown> | Record<string, unknown>[])[0];
  if (!stmt) throw new StatementParseError("invalidFile");
  const acct = stmt.Acct as Record<string, unknown> | undefined;
  const iban = text((acct?.Id as Record<string, unknown> | undefined)?.IBAN);
  const balances = arr(stmt.Bal as Record<string, unknown>[]);
  const balance = (codes: string[]) => {
    const b = balances.find((x) => codes.includes(text(((x.Tp as Record<string, unknown>)?.CdOrPrtry as Record<string, unknown>)?.Cd) ?? ""));
    if (!b) return null;
    const amt = dec(text(b.Amt) ?? "0");
    return (text(b.CdtDbtInd) === "DBIT" ? amt.negated() : amt).toFixed(2);
  };
  const period = stmt.FrToDt as Record<string, unknown> | undefined;

  const entries: StatementEntry[] = [];
  for (const ntry of arr(stmt.Ntry as Record<string, unknown>[])) {
    const status = text((ntry.Sts as Record<string, unknown> | undefined)?.Cd ?? ntry.Sts);
    if (status && status !== "BOOK") continue;
    const ccy = text((ntry.Amt as Record<string, unknown> | undefined)?.["@Ccy"]) ?? text(acct?.Ccy) ?? "EUR";
    const credit = text(ntry.CdtDbtInd) === "CRDT";
    const date = dateOf(ntry.BookgDt) ?? dateOf(ntry.ValDt);
    const details = arr(((ntry.NtryDtls as Record<string, unknown> | undefined)?.TxDtls ?? []) as Record<string, unknown>[]);
    const txs = details.length ? details : [undefined];
    for (const tx of txs) {
      const txAmt = tx?.Amt ?? (tx?.AmtDtls as Record<string, unknown> | undefined)?.TxAmt;
      const amountText = text((txAmt as Record<string, unknown> | undefined)?.Amt ?? txAmt) ?? (txs.length === 1 ? text(ntry.Amt) : null);
      if (!amountText || !date) continue;
      const amount = dec(amountText);
      const parties = tx?.RltdPties as Record<string, unknown> | undefined;
      const party = (credit ? parties?.Dbtr : parties?.Cdtr) as Record<string, unknown> | undefined;
      const partyAcct = (credit ? parties?.DbtrAcct : parties?.CdtrAcct) as Record<string, unknown> | undefined;
      const rmt = tx?.RmtInf as Record<string, unknown> | undefined;
      const strd = arr(rmt?.Strd as Record<string, unknown>[]);
      const reference = strd.map((s) => text((s.CdtrRefInf as Record<string, unknown> | undefined)?.Ref)).find(Boolean) ?? null;
      const ustrd = arr(rmt?.Ustrd as unknown[]).map(text).filter(Boolean).join(" ");
      const refs = tx?.Refs as Record<string, unknown> | undefined;
      entries.push({
        date,
        amount: (credit ? amount : amount.negated()).toFixed(2),
        currency: ccy,
        partyName: text(party?.Nm ?? (party?.Pty as Record<string, unknown> | undefined)?.Nm),
        partyIban: text((partyAcct?.Id as Record<string, unknown> | undefined)?.IBAN)?.toUpperCase() ?? null,
        referenceNumber: reference,
        description: ustrd || text(ntry.AddtlNtryInf),
        bankReference: text(refs?.AcctSvcrRef) ?? text(ntry.AcctSvcrRef) ?? text(refs?.EndToEndId) ?? null,
      });
    }
  }
  if (entries.length === 0) throw new StatementParseError("noEntries");
  return {
    externalId: text(stmt.Id),
    iban: iban ? normalizeIban(iban) : null,
    currency: text(acct?.Ccy),
    fromDate: dateOf(period?.FrDtTm),
    toDate: dateOf(period?.ToDtTm),
    openingBalance: balance(["OPBD", "PRCD"]),
    closingBalance: balance(["CLBD"]),
    entries,
  };
}

// --- CSV ---------------------------------------------------------------------

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}/]+/gu, "");

/** Veerunimed Eesti pankade (Swedbank, SEB, LHV, Luminor, Coop) CSV-des ja inglise keeles. */
const COLUMNS: Record<keyof StatementEntry | "dc" | "account", string[]> = {
  date: ["kuupäev", "kuupaev", "date", "bookingdate", "tehingukuupäev", "kandekuupäev"],
  amount: ["summa", "amount"],
  currency: ["valuuta", "currency"],
  partyName: ["saaja/maksja", "saaja/maksjanimi", "maksja/saaja", "saajavõimaksja", "osapool", "counterparty", "beneficiary/payer", "saaja/maksja nimi", "beneficiary's name", "beneficiary/payer name"],
  partyIban: ["saaja/maksjakonto", "saaja/maksja konto", "vastaspoolekonto", "counterpartyaccount", "kontonumber", "beneficiary's account", "beneficiary/payer account"],
  referenceNumber: ["viitenumber", "viide", "referencenumber", "reference"],
  description: ["selgitus", "description", "details", "makseselgitus"],
  bankReference: ["arhiveerimistunnus", "arhiivitunnus", "archiveid", "archivingcode", "archivecode", "transactionid", "kandeid", "dokumendinumber"],
  dc: ["deebet/kreedit", "deebet/kreedit(d/c)", "d/c", "debit/credit", "deebetkreedit"],
  account: ["kliendikonto", "customeraccountno", "customeraccount", "account"],
};

function parseCsvDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export function parseBankCsv(raw: string): ParsedStatement {
  const content = raw.replace(/^﻿/, "");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new StatementParseError("invalidFile");
  const sep = [";", ",", "\t"].map((s) => [s, lines[0]!.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const header = splitCsvLine(lines[0]!, sep).map(norm);
  const idx = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.map(norm).includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (idx.date < 0 || idx.amount < 0) throw new StatementParseError("invalidFile");
  const lineType = header.findIndex((h) => h === norm("reatüüp"));

  const entries: StatementEntry[] = [];
  let iban: string | null = null;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, sep);
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    // Swedbanki CSV: ainult tehinguread (reatüüp 20), mitte saldod
    if (lineType >= 0 && get(lineType) && get(lineType) !== "20") continue;
    const date = parseCsvDate(get(idx.date));
    const amountRaw = parseMoneyInput(get(idx.amount));
    if (!date || !amountRaw) continue;
    const dc = get(idx.dc).toUpperCase();
    const amount = dc === "D" ? amountRaw.abs().negated() : dc === "K" || dc === "C" ? amountRaw.abs() : amountRaw;
    if (!iban && get(idx.account)) iban = normalizeIban(get(idx.account));
    entries.push({
      date,
      amount: amount.toFixed(2),
      currency: get(idx.currency) || "EUR",
      partyName: get(idx.partyName) || null,
      partyIban: get(idx.partyIban) ? normalizeIban(get(idx.partyIban)) : null,
      referenceNumber: get(idx.referenceNumber) || null,
      description: get(idx.description) || null,
      bankReference: get(idx.bankReference) || null,
    });
  }
  if (entries.length === 0) throw new StatementParseError("noEntries");
  const dates = entries.map((e) => e.date).sort();
  return {
    externalId: null,
    iban,
    currency: entries[0]!.currency,
    fromDate: dates[0]!,
    toDate: dates[dates.length - 1]!,
    openingBalance: null,
    closingBalance: null,
    entries,
  };
}

/** Faili sisu järgi õige lugeja. */
export function parseStatement(content: string): { format: "CAMT053" | "CSV"; statement: ParsedStatement } {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("<")) return { format: "CAMT053", statement: parseCamt053(content) };
  return { format: "CSV", statement: parseBankCsv(content) };
}
