import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/lib/money";
import { deleteJournalEntry, postJournalEntry } from "./journal";
import { monthPeriod, periodKey, vatAccounts } from "@/server/reports/vat";

/**
 * KMD sulgemiskanne: perioodi arvestatud ja sisendkäibemaksu kontode käive kantakse
 * käibemaksu arvelduse kontole (roll VAT_PAYABLE). Üks kanne kuu kohta; avatud perioodis
 * saab sulgemise tühistada (kanne kustutatakse).
 */

type Tx = Prisma.TransactionClient;

export type VatErrorCode = "alreadyClosed" | "notClosed" | "noVatPayableAccount" | "nothingToClose";

export class VatError extends Error {
  constructor(
    public code: VatErrorCode,
    public meta: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = "VatError";
  }
}

export async function closeVatPeriod(tx: Tx, companyId: string, userId: string | null, year: number, month: number) {
  const key = periodKey(year, month);
  const existing = await tx.journalEntry.findFirst({ where: { companyId, source: "VAT_CLOSING", sourceId: key } });
  if (existing) throw new VatError("alreadyClosed", { period: key });
  const payable = await tx.glAccount.findFirst({ where: { companyId, role: "VAT_PAYABLE" }, select: { id: true } });
  if (!payable) throw new VatError("noVatPayableAccount");

  const { from, to } = monthPeriod(year, month);
  const { output, input } = await vatAccounts(tx, companyId);
  const accounts = [...new Set([...output, ...input])].filter((id) => id !== payable.id);
  const sums = accounts.length
    ? await tx.journalLine.groupBy({
        by: ["accountId"],
        where: {
          companyId,
          accountId: { in: accounts },
          entry: { status: "POSTED", date: { gte: from, lte: to }, source: { not: "VAT_CLOSING" } },
        },
        _sum: { debit: true, credit: true },
      })
    : [];

  const lines: Array<{ accountId: string; debit: string; credit: string; description: string }> = [];
  let net = dec(0);
  for (const s of sums) {
    const balance = dec(s._sum.debit ?? 0).minus(dec(s._sum.credit ?? 0));
    if (balance.isZero()) continue;
    net = net.plus(balance);
    // Saldo nullitakse vastaspoolega
    lines.push({
      accountId: s.accountId,
      debit: balance.isNegative() ? balance.negated().toFixed(2) : "0",
      credit: balance.isPositive() ? balance.toFixed(2) : "0",
      description: `KMD ${key}`,
    });
  }
  if (lines.length === 0) throw new VatError("nothingToClose", { period: key });
  if (!net.isZero()) {
    lines.push({
      accountId: payable.id,
      debit: net.isPositive() ? net.toFixed(2) : "0",
      credit: net.isNegative() ? net.negated().toFixed(2) : "0",
      description: net.isNegative() ? `KMD ${key} tasumisele` : `KMD ${key} enammakse`,
    });
  }
  const entry = await postJournalEntry(tx, companyId, userId, {
    date: to,
    source: "VAT_CLOSING",
    sourceId: key,
    description: `Käibemaksu sulgemine ${key}`,
    lines,
  });
  return entry.id;
}

export async function reopenVatPeriod(tx: Tx, companyId: string, year: number, month: number) {
  const key = periodKey(year, month);
  const entry = await tx.journalEntry.findFirst({ where: { companyId, source: "VAT_CLOSING", sourceId: key } });
  if (!entry) throw new VatError("notClosed", { period: key });
  await deleteJournalEntry(tx, companyId, entry.id);
}
