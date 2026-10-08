import type { Prisma } from "@/generated/prisma/client";
import { validateEntryLines, type EntryIssue } from "@/lib/accounting/ledger";
import { periodState, type PeriodState } from "@/lib/accounting/fiscal";
import { toISODate } from "@/lib/accounting/dates";
import { dec, toMoneyString, type DecimalInput } from "@/lib/money";
import { nextDocumentNumber } from "./numbering";

type Tx = Prisma.TransactionClient;

export type JournalSource =
  | "OPENING_BALANCE"
  | "MANUAL"
  | "SALES_INVOICE"
  | "PURCHASE_INVOICE"
  | "PAYMENT"
  | "INVENTORY"
  | "DEPRECIATION"
  | "VAT_CLOSING"
  | "YEAR_END";

export type JournalLineInput = {
  accountId: string;
  debit?: DecimalInput;
  credit?: DecimalInput;
  description?: string | null;
  departmentId?: string | null;
  vatRateId?: string | null;
  vatAmount?: DecimalInput | null;
  dimensionValueIds?: string[];
};

export type JournalEntryInput = {
  date: Date;
  source: JournalSource;
  sourceId?: string | null;
  description?: string | null;
  /** Kui puudub, võetakse kannete numbriseeriast */
  number?: string;
  lines: JournalLineInput[];
};

export type LedgerErrorCode =
  | EntryIssue["code"]
  | "accountNotFound"
  | "accountInactive"
  | "accountNotPostable"
  | "currentYearProfitAccount"
  | "departmentRequired"
  | "departmentNotFound"
  | "dimensionRequired"
  | "dimensionValueNotFound"
  | "dimensionValueEnded"
  | "duplicateDimension"
  | "vatRateNotFound"
  | Exclude<PeriodState, "open">;

/** Pearaamatu reegli rikkumine. `code` on i18n võti nimeruumis `ledgerErrors`. */
export class LedgerError extends Error {
  constructor(
    public code: LedgerErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "LedgerError";
  }
}

/**
 * Kontrollib ja salvestab pearaamatu kande. Kõik reeglid ühes kohas:
 * - deebet = kreedit, iga rida ainult ühel poolel, summad kuni 2 komakohta;
 * - kontod kuuluvad ettevõttele, on aktiivsed ja detailsed;
 * - aruandeaasta kasumi kontole kandeid ei tehta (v.a aasta sulgemine);
 * - kohustuslik osakond/dimensioon on olemas, dimensioonist ainult üks väärtus;
 * - kuupäev on avatud perioodis (algsaldod võivad olla enne esimest majandusaastat).
 */
export async function postJournalEntry(tx: Tx, companyId: string, userId: string | null, input: JournalEntryInput) {
  const issue = validateEntryLines(input.lines);
  if (issue) {
    const { code, ...meta } = issue;
    throw new LedgerError(code, meta as Record<string, string | number>);
  }

  await assertPeriodOpen(tx, companyId, input.date, input.source);

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await tx.glAccount.findMany({ where: { companyId, id: { in: accountIds } } });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const departmentIds = [...new Set(input.lines.flatMap((l) => (l.departmentId ? [l.departmentId] : [])))];
  const departments = departmentIds.length
    ? await tx.department.findMany({ where: { companyId, id: { in: departmentIds }, active: true }, select: { id: true } })
    : [];
  const departmentSet = new Set(departments.map((d) => d.id));

  const vatIds = [...new Set(input.lines.flatMap((l) => (l.vatRateId ? [l.vatRateId] : [])))];
  const vats = vatIds.length ? await tx.vatRate.findMany({ where: { companyId, id: { in: vatIds } }, select: { id: true } }) : [];
  const vatSet = new Set(vats.map((v) => v.id));

  const valueIds = [...new Set(input.lines.flatMap((l) => l.dimensionValueIds ?? []))];
  const values = valueIds.length
    ? await tx.dimensionValue.findMany({ where: { companyId, id: { in: valueIds } }, include: { dimension: true } })
    : [];
  const valueById = new Map(values.map((v) => [v.id, v]));

  input.lines.forEach((line, index) => {
    const account = accountById.get(line.accountId);
    if (!account) throw new LedgerError("accountNotFound", { index });
    if (!account.active) throw new LedgerError("accountInactive", { index, account: account.code });
    if (account.kind !== "DETAIL") throw new LedgerError("accountNotPostable", { index, account: account.code });
    if (account.role === "CURRENT_YEAR_PROFIT" && input.source !== "YEAR_END") {
      throw new LedgerError("currentYearProfitAccount", { index, account: account.code });
    }
    if (line.departmentId && !departmentSet.has(line.departmentId)) throw new LedgerError("departmentNotFound", { index });
    if (account.requiresDepartment && !line.departmentId) {
      throw new LedgerError("departmentRequired", { index, account: account.code });
    }
    if (line.vatRateId && !vatSet.has(line.vatRateId)) throw new LedgerError("vatRateNotFound", { index });

    const seenDimensions = new Set<string>();
    for (const valueId of line.dimensionValueIds ?? []) {
      const value = valueById.get(valueId);
      if (!value) throw new LedgerError("dimensionValueNotFound", { index });
      if (value.endDate && value.endDate.getTime() < input.date.getTime()) {
        throw new LedgerError("dimensionValueEnded", { index, value: value.code });
      }
      if (seenDimensions.has(value.dimensionId)) throw new LedgerError("duplicateDimension", { index });
      seenDimensions.add(value.dimensionId);
    }
    for (const required of account.requiredDimensionIds) {
      if (!seenDimensions.has(required)) throw new LedgerError("dimensionRequired", { index, account: account.code });
    }
  });

  const number =
    input.number ??
    (input.source === "OPENING_BALANCE" ? "ALGSALDO" : await nextDocumentNumber(tx, companyId, "JOURNAL_ENTRY", input.date));

  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number,
      date: input.date,
      source: input.source,
      sourceId: input.sourceId ?? null,
      description: input.description ?? null,
      createdById: userId,
    },
  });

  for (const [sortOrder, line] of input.lines.entries()) {
    const created = await tx.journalLine.create({
      data: {
        companyId,
        entryId: entry.id,
        accountId: line.accountId,
        debit: toMoneyString(line.debit ?? 0),
        credit: toMoneyString(line.credit ?? 0),
        description: line.description ?? null,
        departmentId: line.departmentId ?? null,
        vatRateId: line.vatRateId ?? null,
        vatAmount: line.vatAmount === undefined || line.vatAmount === null ? null : toMoneyString(line.vatAmount),
        sortOrder,
      },
    });
    if (line.dimensionValueIds?.length) {
      await tx.journalLineDimension.createMany({
        data: line.dimensionValueIds.map((dimensionValueId) => ({ companyId, lineId: created.id, dimensionValueId })),
      });
    }
  }
  return entry;
}

/** Viskab LedgerError-i, kui kuupäevale ei tohi kandeid teha. */
export async function assertPeriodOpen(tx: Tx, companyId: string, date: Date, source: JournalSource) {
  const [company, years] = await Promise.all([
    tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { lockedUntil: true } }),
    tx.fiscalYear.findMany({ where: { companyId } }),
  ]);
  const state = periodState(date, years, company.lockedUntil);
  // Algsaldod on arvestuse algusele eelneva päeva seisuga ja võivad jääda enne esimest aastat.
  if (state === "open" || (source === "OPENING_BALANCE" && state === "noFiscalYear")) return;
  throw new LedgerError(state, { date: toISODate(date) });
}

/** Kustutab kande (ainult avatud perioodis; kasutatakse algsaldode ja mustandite ümbertegemisel). */
export async function deleteJournalEntry(tx: Tx, companyId: string, entryId: string) {
  const entry = await tx.journalEntry.findFirst({ where: { companyId, id: entryId } });
  if (!entry) return;
  await assertPeriodOpen(tx, companyId, entry.date, entry.source);
  await tx.journalEntry.delete({ where: { id: entry.id } });
}

/** Kontode saldod (deebet, kreedit) kuni kuupäevani k.a. */
export async function accountTotals(tx: Tx, companyId: string, until?: Date) {
  const rows = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId, ...(until ? { entry: { date: { lte: until } } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return new Map(
    rows.map((r) => [r.accountId, { debit: dec(r._sum.debit ?? 0), credit: dec(r._sum.credit ?? 0) }]),
  );
}
