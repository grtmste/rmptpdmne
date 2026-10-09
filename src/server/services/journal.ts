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
  | "EXPENSE_REPORT"
  | "PAYMENT"
  | "INVENTORY"
  | "DEPRECIATION"
  | "FIXED_ASSET"
  | "VAT_CLOSING"
  | "YEAR_END";

export type JournalLineInput = {
  accountId: string;
  debit?: DecimalInput;
  credit?: DecimalInput;
  description?: string | null;
  departmentId?: string | null;
  vatRateId?: string | null;
  /**
   * Käibemaksu summa, mille alusel rida KMD-l kajastub. Märk tuleneb rea poolest
   * (storno vahetab pooled ja seega ka mõju), summa ise on alati positiivne.
   */
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
  reversalOfId?: string | null;
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
  | "entryNotFound"
  | "notDraft"
  | "notPosted"
  | "alreadyReversed"
  | "cannotReverse"
  | Exclude<PeriodState, "open">;

/** Pearaamatu reegli rikkumine. `code` on i18n võti nimeruumis `errors.ledger`. */
export class LedgerError extends Error {
  constructor(
    public code: LedgerErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "LedgerError";
  }
}

/** Ainult postitatud kanded mõjutavad saldosid ja aruandeid. */
export const POSTED: Prisma.JournalEntryWhereInput = { status: "POSTED" };

type Refs = {
  accounts: Map<string, Prisma.GlAccountGetPayload<object>>;
  departments: Set<string>;
  vats: Set<string>;
  values: Map<string, { id: string; code: string; dimensionId: string; endDate: Date | null }>;
};

async function loadRefs(tx: Tx, companyId: string, lines: JournalLineInput[], activeDepartmentsOnly: boolean): Promise<Refs> {
  const ids = (pick: (l: JournalLineInput) => string | null | undefined) => [
    ...new Set(lines.flatMap((l) => (pick(l) ? [pick(l)!] : []))),
  ];
  const accountIds = ids((l) => l.accountId);
  const departmentIds = ids((l) => l.departmentId);
  const vatIds = ids((l) => l.vatRateId);
  const valueIds = [...new Set(lines.flatMap((l) => l.dimensionValueIds ?? []))];
  const [accounts, departments, vats, values] = await Promise.all([
    accountIds.length ? tx.glAccount.findMany({ where: { companyId, id: { in: accountIds } } }) : [],
    departmentIds.length
      ? tx.department.findMany({
          where: { companyId, id: { in: departmentIds }, ...(activeDepartmentsOnly ? { active: true } : {}) },
          select: { id: true },
        })
      : [],
    vatIds.length ? tx.vatRate.findMany({ where: { companyId, id: { in: vatIds } }, select: { id: true } }) : [],
    valueIds.length
      ? tx.dimensionValue.findMany({
          where: { companyId, id: { in: valueIds } },
          select: { id: true, code: true, dimensionId: true, endDate: true },
        })
      : [],
  ]);
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    departments: new Set(departments.map((d) => d.id)),
    vats: new Set(vats.map((v) => v.id)),
    values: new Map(values.map((v) => [v.id, v])),
  };
}

/** Kontrollib, et kõik viidatud kirjed kuuluvad ettevõttele (ka mustandi puhul). */
function assertReferences(lines: JournalLineInput[], refs: Refs) {
  lines.forEach((line, index) => {
    if (!refs.accounts.has(line.accountId)) throw new LedgerError("accountNotFound", { index });
    if (line.departmentId && !refs.departments.has(line.departmentId)) throw new LedgerError("departmentNotFound", { index });
    if (line.vatRateId && !refs.vats.has(line.vatRateId)) throw new LedgerError("vatRateNotFound", { index });
    const seen = new Set<string>();
    for (const valueId of line.dimensionValueIds ?? []) {
      const value = refs.values.get(valueId);
      if (!value) throw new LedgerError("dimensionValueNotFound", { index });
      if (seen.has(value.dimensionId)) throw new LedgerError("duplicateDimension", { index });
      seen.add(value.dimensionId);
    }
  });
}

/**
 * Postitamise reeglid ühes kohas:
 * - deebet = kreedit, iga rida ainult ühel poolel, summad kuni 2 komakohta;
 * - kontod kuuluvad ettevõttele, on aktiivsed ja detailsed;
 * - aruandeaasta kasumi kontole kandeid ei tehta (v.a aasta sulgemine);
 * - kohustuslik osakond/dimensioon on olemas, dimensioonist ainult üks väärtus;
 * - kuupäev on avatud perioodis (algsaldod võivad olla enne esimest majandusaastat).
 */
export async function validateForPosting(tx: Tx, companyId: string, input: JournalEntryInput) {
  const issue = validateEntryLines(input.lines);
  if (issue) {
    const { code, ...meta } = issue;
    throw new LedgerError(code, meta as Record<string, string | number>);
  }
  await assertPeriodOpen(tx, companyId, input.date, input.source);
  const refs = await loadRefs(tx, companyId, input.lines, true);
  assertReferences(input.lines, refs);
  input.lines.forEach((line, index) => {
    const account = refs.accounts.get(line.accountId)!;
    if (!account.active) throw new LedgerError("accountInactive", { index, account: account.code });
    if (account.kind !== "DETAIL") throw new LedgerError("accountNotPostable", { index, account: account.code });
    if (account.role === "CURRENT_YEAR_PROFIT" && input.source !== "YEAR_END") {
      throw new LedgerError("currentYearProfitAccount", { index, account: account.code });
    }
    if (account.requiresDepartment && !line.departmentId) {
      throw new LedgerError("departmentRequired", { index, account: account.code });
    }
    const dims = new Set<string>();
    for (const valueId of line.dimensionValueIds ?? []) {
      const value = refs.values.get(valueId)!;
      if (value.endDate && value.endDate.getTime() < input.date.getTime()) {
        throw new LedgerError("dimensionValueEnded", { index, value: value.code });
      }
      dims.add(value.dimensionId);
    }
    for (const required of account.requiredDimensionIds) {
      if (!dims.has(required)) throw new LedgerError("dimensionRequired", { index, account: account.code });
    }
  });
}

async function createLines(tx: Tx, companyId: string, entryId: string, lines: JournalLineInput[]) {
  for (const [sortOrder, line] of lines.entries()) {
    const created = await tx.journalLine.create({
      data: {
        companyId,
        entryId,
        accountId: line.accountId,
        debit: toMoneyString(line.debit ?? 0),
        credit: toMoneyString(line.credit ?? 0),
        description: line.description || null,
        departmentId: line.departmentId || null,
        vatRateId: line.vatRateId || null,
        vatAmount: line.vatAmount === undefined || line.vatAmount === null || line.vatAmount === "" ? null : toMoneyString(line.vatAmount),
        sortOrder,
      },
    });
    if (line.dimensionValueIds?.length) {
      await tx.journalLineDimension.createMany({
        data: line.dimensionValueIds.map((dimensionValueId) => ({ companyId, lineId: created.id, dimensionValueId })),
      });
    }
  }
}

async function numberFor(tx: Tx, companyId: string, input: JournalEntryInput) {
  if (input.number) return input.number;
  if (input.source === "OPENING_BALANCE") return "ALGSALDO";
  return nextDocumentNumber(tx, companyId, "JOURNAL_ENTRY", input.date);
}

/** Kontrollib ja salvestab postitatud kande. */
export async function postJournalEntry(tx: Tx, companyId: string, userId: string | null, input: JournalEntryInput) {
  await validateForPosting(tx, companyId, input);
  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number: await numberFor(tx, companyId, input),
      status: "POSTED",
      postedAt: new Date(),
      postedById: userId,
      date: input.date,
      source: input.source,
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      description: input.description ?? null,
      createdById: userId,
    },
  });
  await createLines(tx, companyId, entry.id, input.lines);
  return entry;
}

export type DraftInput = { id?: string; date: Date; description?: string | null; lines: JournalLineInput[] };

/**
 * Salvestab käsitsi kande mustandi. Mustand ei pea olema tasakaalus ega avatud perioodis;
 * kontrollitakse ainult, et viited kuuluvad ettevõttele. Tühjad read jäetakse välja.
 */
export async function saveDraft(tx: Tx, companyId: string, userId: string | null, input: DraftInput) {
  const lines = input.lines.filter((l) => l.accountId);
  const refs = await loadRefs(tx, companyId, lines, false);
  assertReferences(lines, refs);

  let id = input.id;
  if (id) {
    const existing = await tx.journalEntry.findFirst({ where: { companyId, id } });
    if (!existing) throw new LedgerError("entryNotFound");
    if (existing.status !== "DRAFT") throw new LedgerError("notDraft");
    await tx.journalEntry.update({ where: { id }, data: { date: input.date, description: input.description ?? null } });
    await tx.journalLine.deleteMany({ where: { companyId, entryId: id } });
  } else {
    const created = await tx.journalEntry.create({
      data: {
        companyId,
        status: "DRAFT",
        date: input.date,
        source: "MANUAL",
        description: input.description ?? null,
        createdById: userId,
      },
    });
    id = created.id;
  }
  await createLines(tx, companyId, id, lines);
  return id;
}

async function loadAsInput(tx: Tx, companyId: string, id: string) {
  const entry = await tx.journalEntry.findFirst({
    where: { companyId, id },
    include: { lines: { orderBy: { sortOrder: "asc" }, include: { dimensions: true } } },
  });
  if (!entry) throw new LedgerError("entryNotFound");
  const lines: JournalLineInput[] = entry.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit.toString(),
    credit: l.credit.toString(),
    description: l.description,
    departmentId: l.departmentId,
    vatRateId: l.vatRateId,
    vatAmount: l.vatAmount?.toString() ?? null,
    dimensionValueIds: l.dimensions.map((d) => d.dimensionValueId),
  }));
  return { entry, lines };
}

/** Postitab mustandi: kõik reeglid kontrollitakse, kanne saab numbri ja muutub lõplikuks. */
export async function postDraft(tx: Tx, companyId: string, userId: string | null, id: string) {
  const { entry, lines } = await loadAsInput(tx, companyId, id);
  if (entry.status !== "DRAFT") throw new LedgerError("notDraft");
  const input: JournalEntryInput = { date: entry.date, source: entry.source, description: entry.description, lines };
  await validateForPosting(tx, companyId, input);
  // Tingimuslik uuendus: sama mustandit ei saa kaks korda postitada
  const number = await numberFor(tx, companyId, input);
  const res = await tx.journalEntry.updateMany({
    where: { companyId, id, status: "DRAFT" },
    data: { status: "POSTED", number, postedAt: new Date(), postedById: userId },
  });
  if (res.count !== 1) throw new LedgerError("notDraft");
  return { id, number };
}

export async function deleteDraft(tx: Tx, companyId: string, id: string) {
  const entry = await tx.journalEntry.findFirst({ where: { companyId, id } });
  if (!entry) throw new LedgerError("entryNotFound");
  if (entry.status !== "DRAFT") throw new LedgerError("notDraft");
  await tx.journalEntry.delete({ where: { id } });
}

/**
 * Storno: uus postitatud kanne vahetatud pooltega. Algset kannet ei muudeta. Stornida saab
 * ainult käsitsi kandeid (dokumentide kanded parandatakse dokumendi kaudu) ja igaüht üks kord.
 */
export async function reverseEntry(
  tx: Tx,
  companyId: string,
  userId: string | null,
  id: string,
  opts: { date: Date; description?: string | null },
) {
  const { entry, lines } = await loadAsInput(tx, companyId, id);
  if (entry.status !== "POSTED") throw new LedgerError("notPosted");
  if (entry.source !== "MANUAL" || entry.reversalOfId) throw new LedgerError("cannotReverse");
  const already = await tx.journalEntry.count({ where: { companyId, reversalOfId: id } });
  if (already > 0) throw new LedgerError("alreadyReversed");
  return postJournalEntry(tx, companyId, userId, {
    date: opts.date,
    source: "MANUAL",
    reversalOfId: id,
    description: opts.description ?? `Storno: ${entry.number}${entry.description ? ` – ${entry.description}` : ""}`,
    lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
  });
}

/** Kopeerib mis tahes kande uueks mustandiks (nt sarnase kande kiireks sisestamiseks). */
export async function copyToDraft(tx: Tx, companyId: string, userId: string | null, id: string, date: Date) {
  const { entry, lines } = await loadAsInput(tx, companyId, id);
  return saveDraft(tx, companyId, userId, { date, description: entry.description, lines });
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

/** Kustutab kande (ainult avatud perioodis; kasutatakse algsaldode ümbertegemisel). */
export async function deleteJournalEntry(tx: Tx, companyId: string, entryId: string) {
  const entry = await tx.journalEntry.findFirst({ where: { companyId, id: entryId } });
  if (!entry) return;
  await assertPeriodOpen(tx, companyId, entry.date, entry.source);
  await tx.journalEntry.delete({ where: { id: entry.id } });
}

/** Kontode saldod (deebet, kreedit) kuni kuupäevani k.a; ainult postitatud kanded. */
export async function accountTotals(tx: Tx, companyId: string, until?: Date) {
  const rows = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId, entry: { ...POSTED, ...(until ? { date: { lte: until } } : {}) } },
    _sum: { debit: true, credit: true },
  });
  return new Map(rows.map((r) => [r.accountId, { debit: dec(r._sum.debit ?? 0), credit: dec(r._sum.credit ?? 0) }]));
}
