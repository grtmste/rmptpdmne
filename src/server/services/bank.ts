import type { Prisma } from "@/generated/prisma/client";
import { parseISODate, toISODate, addDays } from "@/lib/accounting/dates";
import { normalizeIban } from "@/lib/iban";
import { dec, sum } from "@/lib/money";
import type { ParsedStatement } from "@/lib/payments/statement";
import { buildPain001 } from "@/lib/payments/pain001";
import { confirmPayment, openItems, PaymentError, savePayment, type AllocationInput, type OpenItem } from "./payments";

type Tx = Prisma.TransactionClient;

/**
 * Pangaväljavõtte import ja automaatne sobitamine.
 *
 * Laekumine: viitenumber (arve või kliendi püsiviide) → arve number selgituses → kliendi nimi
 *   ja täpne tasumata summa. Kui summa ei kata arvet täpselt, jääb vahe kliendi ettemaksuks.
 * Väljamakse: olemasolev makse (nt maksekorraldusest) → tarnija IBAN/nimi ja täpne summa või arve number
 *   selgituses → aruandev isik IBAN-i järgi → pangateenustasu.
 * Soovitust ei kinnitata automaatselt – kasutaja kinnitab (ühekaupa või kõik soovitused korraga).
 */

export type Suggestion =
  | {
      kind: "allocations";
      partyType: "CUSTOMER" | "SUPPLIER" | "EMPLOYEE";
      partyId: string;
      partyName: string;
      allocations: Array<{ type: "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REPORT" | "PREPAYMENT"; id: string | null; number: string | null; amount: string }>;
      reason: "reference" | "number" | "amount" | "prepayment";
    }
  | { kind: "payment"; paymentId: string; number: string | null; reason: "existing" }
  | { kind: "account"; accountId: string; accountCode: string; reason: "bankFee" };

const FEE = /teenustasu|tasu |komisjon|service fee|bank fee|kuutasu|haldustasu/i;

export async function importStatement(
  tx: Tx,
  companyId: string,
  userId: string | null,
  opts: { bankAccountId: string; fileName: string; format: "CAMT053" | "CSV"; statement: ParsedStatement },
) {
  const bank = await tx.bankAccount.findFirst({ where: { companyId, id: opts.bankAccountId } });
  if (!bank) throw new PaymentError("bankAccountNotFound");
  const s = opts.statement;
  if (s.iban && bank.iban && normalizeIban(s.iban) !== normalizeIban(bank.iban)) {
    throw new PaymentError("ibanMismatch", { iban: s.iban });
  }
  // Juba imporditud tehingud jäetakse vahele (panga tehingu tunnuse järgi)
  const refs = s.entries.map((e) => e.bankReference).filter((x): x is string => Boolean(x));
  const existing = new Set(
    (
      await tx.bankStatementLine.findMany({
        where: { companyId, bankAccountId: bank.id, bankReference: { in: refs } },
        select: { bankReference: true },
      })
    ).map((l) => l.bankReference),
  );
  const fresh = s.entries.filter((e) => !e.bankReference || !existing.has(e.bankReference));
  const statement = await tx.bankStatement.create({
    data: {
      companyId,
      bankAccountId: bank.id,
      format: opts.format,
      fileName: opts.fileName,
      externalId: s.externalId,
      fromDate: s.fromDate ? parseISODate(s.fromDate) : null,
      toDate: s.toDate ? parseISODate(s.toDate) : null,
      openingBalance: s.openingBalance,
      closingBalance: s.closingBalance,
      createdById: userId,
    },
  });
  await tx.bankStatementLine.createMany({
    data: fresh.map((e, sortOrder) => ({
      companyId,
      statementId: statement.id,
      bankAccountId: bank.id,
      date: parseISODate(e.date)!,
      amount: e.amount,
      currency: e.currency,
      partyName: e.partyName,
      partyIban: e.partyIban,
      referenceNumber: e.referenceNumber,
      description: e.description,
      bankReference: e.bankReference,
      sortOrder,
    })),
  });
  await matchStatement(tx, companyId, statement.id);
  return { id: statement.id, imported: fresh.length, skipped: s.entries.length - fresh.length };
}

const simplify = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\b(oü|as|mtü|fie|sa|tü|uab|sia|oy|ab|ltd|llc|gmbh)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Laekumise/väljamakse jaotus arvetele: täpne summa → üks arve; muidu vanimad ees, jääk ettemaksuks. */
function allocateToItems(items: OpenItem[], amount: ReturnType<typeof dec>, allowPrepayment: boolean) {
  const exact = items.find((i) => dec(i.open).equals(amount));
  if (exact) return [{ type: exact.type, id: exact.id, number: exact.number, amount: exact.open }];
  const out: Array<{ type: OpenItem["type"] | "PREPAYMENT"; id: string | null; number: string | null; amount: string }> = [];
  let left = amount;
  for (const i of items) {
    const open = dec(i.open);
    if (!open.isPositive() || left.isZero()) continue;
    const take = open.lessThan(left) ? open : left;
    out.push({ type: i.type, id: i.id, number: i.number, amount: take.toFixed(2) });
    left = left.minus(take);
  }
  if (!left.isZero()) {
    if (!allowPrepayment) return null;
    out.push({ type: "PREPAYMENT", id: null, number: null, amount: left.toFixed(2) });
  }
  return out;
}

export async function suggestForLine(
  tx: Tx,
  companyId: string,
  line: { id: string; date: Date; amount: { toString(): string }; partyName: string | null; partyIban: string | null; referenceNumber: string | null; description: string | null; bankAccountId: string },
): Promise<Suggestion | null> {
  const amount = dec(line.amount.toString());
  const text = `${line.description ?? ""} ${line.referenceNumber ?? ""}`;

  if (amount.isPositive()) {
    // 1. Viitenumber
    if (line.referenceNumber) {
      const ref = line.referenceNumber.replace(/\s+/g, "").replace(/^0+/, "");
      const invoice = await tx.salesInvoice.findFirst({ where: { companyId, status: "CONFIRMED", referenceNumber: ref }, select: { customerId: true, customerName: true } });
      const customer = invoice
        ? { id: invoice.customerId, name: invoice.customerName }
        : await tx.customer.findFirst({ where: { companyId, referenceNumber: ref }, select: { id: true, name: true } });
      if (customer) {
        const items = (await openItems(tx, companyId, { types: ["SALES_INVOICE"], customerId: customer.id })).filter((i) => dec(i.open).isPositive());
        const byRef = items.filter((i) => i.referenceNumber === ref);
        const allocations = allocateToItems([...byRef, ...items.filter((i) => i.referenceNumber !== ref)], amount, true);
        if (allocations) return { kind: "allocations", partyType: "CUSTOMER", partyId: customer.id, partyName: customer.name, allocations, reason: "reference" };
      }
    }
    // 2. Arve number selgituses
    const items = (await openItems(tx, companyId, { types: ["SALES_INVOICE"] })).filter((i) => dec(i.open).isPositive());
    const byNumber = items.find((i) => i.number && new RegExp(`(^|[^0-9A-Za-z])${i.number.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^0-9A-Za-z]|$)`).test(text));
    if (byNumber && byNumber.partyId) {
      const allocations = allocateToItems([byNumber, ...items.filter((i) => i.partyId === byNumber.partyId && i.id !== byNumber.id)], amount, true);
      if (allocations) return { kind: "allocations", partyType: "CUSTOMER", partyId: byNumber.partyId, partyName: byNumber.partyName, allocations, reason: "number" };
    }
    // 3. Kliendi nimi ja täpne summa
    const name = simplify(line.partyName);
    if (name) {
      const sameName = items.filter((i) => simplify(i.partyName) === name);
      const exact = sameName.find((i) => dec(i.open).equals(amount));
      if (exact && exact.partyId) {
        return {
          kind: "allocations",
          partyType: "CUSTOMER",
          partyId: exact.partyId,
          partyName: exact.partyName,
          allocations: [{ type: "SALES_INVOICE", id: exact.id, number: exact.number, amount: exact.open }],
          reason: "amount",
        };
      }
      const customer = await tx.customer.findFirst({ where: { companyId, name: { equals: line.partyName ?? "", mode: "insensitive" } }, select: { id: true, name: true } });
      if (customer) {
        return {
          kind: "allocations",
          partyType: "CUSTOMER",
          partyId: customer.id,
          partyName: customer.name,
          allocations: [{ type: "PREPAYMENT", id: null, number: null, amount: amount.toFixed(2) }],
          reason: "prepayment",
        };
      }
    }
    return null;
  }

  const out = amount.negated();
  // 1. Olemasolev kinnitatud makse (maksekorraldus), mis ei ole väljavõttega seotud
  const payment = await tx.payment.findFirst({
    where: {
      companyId,
      bankAccountId: line.bankAccountId,
      direction: "OUT",
      status: "CONFIRMED",
      cancelledAt: null,
      statementLineId: null,
      amount: out.toFixed(2),
      date: { gte: addDays(line.date, -7), lte: addDays(line.date, 3) },
      ...(line.partyIban ? { OR: [{ partyIban: line.partyIban }, { partyIban: null }] } : {}),
    },
    orderBy: { date: "desc" },
    select: { id: true, number: true },
  });
  if (payment) return { kind: "payment", paymentId: payment.id, number: payment.number, reason: "existing" };

  // 2. Tarnija IBAN-i või nime järgi
  const supplier =
    (line.partyIban ? await tx.supplier.findFirst({ where: { companyId, bankAccount: line.partyIban }, select: { id: true, name: true } }) : null) ??
    (line.partyName ? await tx.supplier.findFirst({ where: { companyId, name: { equals: line.partyName, mode: "insensitive" } }, select: { id: true, name: true } }) : null);
  if (supplier) {
    const items = (await openItems(tx, companyId, { types: ["PURCHASE_INVOICE"], supplierId: supplier.id })).filter((i) => dec(i.open).isPositive());
    const byNumber = items.find((i) => (i.invoiceNumber && text.includes(i.invoiceNumber)) || (i.referenceNumber && line.referenceNumber === i.referenceNumber));
    const ordered = byNumber ? [byNumber, ...items.filter((i) => i.id !== byNumber.id)] : items;
    const allocations = allocateToItems(ordered, out, true);
    if (allocations) {
      return { kind: "allocations", partyType: "SUPPLIER", partyId: supplier.id, partyName: supplier.name, allocations, reason: byNumber ? "number" : allocations.some((a) => a.type === "PREPAYMENT") ? "prepayment" : "amount" };
    }
  }
  // 3. Aruandev isik IBAN-i järgi
  if (line.partyIban) {
    const employee = await tx.employee.findFirst({ where: { companyId, bankAccount: line.partyIban }, select: { id: true, name: true } });
    if (employee) {
      const items = (await openItems(tx, companyId, { types: ["EXPENSE_REPORT"], employeeId: employee.id })).filter((i) => dec(i.open).isPositive());
      const allocations = allocateToItems(items, out, false);
      if (allocations) return { kind: "allocations", partyType: "EMPLOYEE", partyId: employee.id, partyName: employee.name, allocations, reason: "amount" };
    }
  }
  // 4. Pangateenustasu
  if (!line.partyIban && FEE.test(`${line.description ?? ""} ${line.partyName ?? ""}`)) {
    const fees = await tx.glAccount.findFirst({ where: { companyId, role: "BANK_FEES" }, select: { id: true, code: true } });
    if (fees) return { kind: "account", accountId: fees.id, accountCode: fees.code, reason: "bankFee" };
  }
  return null;
}

/** Sobitab väljavõtte kõik menetlemata read uuesti. */
export async function matchStatement(tx: Tx, companyId: string, statementId: string) {
  const lines = await tx.bankStatementLine.findMany({ where: { companyId, statementId, status: { in: ["NEW", "SUGGESTED"] } }, orderBy: { sortOrder: "asc" } });
  let suggested = 0;
  for (const line of lines) {
    const suggestion = await suggestForLine(tx, companyId, line);
    await tx.bankStatementLine.update({
      where: { id: line.id },
      data: { status: suggestion ? "SUGGESTED" : "NEW", suggestion: suggestion ?? undefined },
    });
    if (suggestion) suggested++;
  }
  return { suggested, total: lines.length };
}

export type LineResolution =
  | { kind: "suggestion" }
  | {
      kind: "manual";
      partyType: "CUSTOMER" | "SUPPLIER" | "EMPLOYEE" | "OTHER";
      partyId?: string | null;
      allocations: AllocationInput[];
      description?: string | null;
    };

/** Kinnitab väljavõtte rea: loob ja kinnitab makse (või seob olemasoleva makse). */
export async function confirmStatementLine(tx: Tx, companyId: string, userId: string | null, lineId: string, resolution: LineResolution) {
  const line = await tx.bankStatementLine.findFirst({ where: { companyId, id: lineId } });
  if (!line) throw new PaymentError("paymentNotFound");
  if (line.status === "DONE") return { paymentId: line.paymentId };
  const amount = dec(line.amount.toString());
  const direction = amount.isNegative() ? "OUT" : "IN";
  let input: Parameters<typeof savePayment>[3] | null = null;

  if (resolution.kind === "suggestion") {
    const s = line.suggestion as Suggestion | null;
    if (!s) throw new PaymentError("noAllocations");
    if (s.kind === "payment") {
      const res = await tx.payment.updateMany({ where: { companyId, id: s.paymentId, statementLineId: null }, data: { statementLineId: line.id } });
      if (res.count !== 1) throw new PaymentError("paymentNotFound");
      await tx.bankStatementLine.update({ where: { id: line.id }, data: { status: "DONE", paymentId: s.paymentId } });
      return { paymentId: s.paymentId };
    }
    if (s.kind === "account") {
      input = {
        direction,
        bankAccountId: line.bankAccountId,
        date: line.date,
        amount: amount.abs().toFixed(2),
        partyType: "OTHER",
        partyName: line.partyName,
        description: line.description,
        statementLineId: line.id,
        allocations: [{ type: "ACCOUNT", accountId: s.accountId, amount: amount.abs().toFixed(2), description: line.description }],
      };
    } else {
      input = {
        direction,
        bankAccountId: line.bankAccountId,
        date: line.date,
        amount: amount.abs().toFixed(2),
        partyType: s.partyType,
        customerId: s.partyType === "CUSTOMER" ? s.partyId : null,
        supplierId: s.partyType === "SUPPLIER" ? s.partyId : null,
        employeeId: s.partyType === "EMPLOYEE" ? s.partyId : null,
        partyIban: line.partyIban,
        referenceNumber: line.referenceNumber,
        description: line.description,
        statementLineId: line.id,
        allocations: s.allocations.map((a) => ({
          type: a.type,
          salesInvoiceId: a.type === "SALES_INVOICE" ? a.id : null,
          purchaseInvoiceId: a.type === "PURCHASE_INVOICE" ? a.id : null,
          expenseReportId: a.type === "EXPENSE_REPORT" ? a.id : null,
          amount: a.amount,
        })),
      };
    }
  } else {
    input = {
      direction,
      bankAccountId: line.bankAccountId,
      date: line.date,
      amount: amount.abs().toFixed(2),
      partyType: resolution.partyType,
      customerId: resolution.partyType === "CUSTOMER" ? resolution.partyId : null,
      supplierId: resolution.partyType === "SUPPLIER" ? resolution.partyId : null,
      employeeId: resolution.partyType === "EMPLOYEE" ? resolution.partyId : null,
      partyName: line.partyName,
      partyIban: line.partyIban,
      referenceNumber: line.referenceNumber,
      description: resolution.description ?? line.description,
      statementLineId: line.id,
      allocations: resolution.allocations,
    };
  }
  const paymentId = await savePayment(tx, companyId, userId, input);
  await confirmPayment(tx, companyId, userId, paymentId);
  await tx.bankStatementLine.update({ where: { id: line.id }, data: { status: "DONE", paymentId } });
  return { paymentId };
}

export async function ignoreStatementLine(tx: Tx, companyId: string, lineId: string, ignore: boolean) {
  const line = await tx.bankStatementLine.findFirst({ where: { companyId, id: lineId }, select: { status: true, suggestion: true } });
  if (!line || line.status === "DONE") throw new PaymentError("paymentNotFound");
  await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: ignore ? "IGNORED" : line.suggestion ? "SUGGESTED" : "NEW" } });
}

// ---------------------------------------------------------------------------
// Maksekorraldused
// ---------------------------------------------------------------------------

export type PaymentOrderItem = { type: "PURCHASE_INVOICE" | "EXPENSE_REPORT"; id: string; amount: string };

export async function createPaymentOrder(
  tx: Tx,
  companyId: string,
  userId: string | null,
  input: { bankAccountId: string; executionDate: Date; items: PaymentOrderItem[] },
) {
  const bank = await tx.bankAccount.findFirst({ where: { companyId, id: input.bankAccountId, kind: "BANK" } });
  if (!bank || !bank.iban) throw new PaymentError("bankAccountNotFound");
  if (input.items.length === 0) throw new PaymentError("noAllocations");
  const lines: Array<Omit<Prisma.PaymentOrderLineCreateManyInput, "companyId" | "orderId">> = [];
  for (const [index, item] of input.items.entries()) {
    const amount = dec(item.amount);
    if (item.type === "PURCHASE_INVOICE") {
      const inv = await tx.purchaseInvoice.findFirst({ where: { companyId, id: item.id, status: "CONFIRMED" } });
      if (!inv) throw new PaymentError("documentNotFound", { index });
      const open = dec(inv.total).minus(dec(inv.paidTotal));
      if (!amount.isPositive() || amount.greaterThan(open)) throw new PaymentError("overpaid", { index, number: inv.number ?? "", open: open.toFixed(2) });
      if (!inv.bankAccount) throw new PaymentError("partyRequired", { index, number: inv.number ?? "" });
      lines.push({
        purchaseInvoiceId: inv.id,
        partyName: inv.supplierName,
        iban: inv.bankAccount,
        amount: amount.toFixed(2),
        referenceNumber: inv.referenceNumber,
        description: inv.referenceNumber ? null : `Arve ${inv.invoiceNumber ?? inv.number ?? ""}`.trim(),
        sortOrder: index,
      });
    } else {
      const rep = await tx.expenseReport.findFirst({ where: { companyId, id: item.id, status: "CONFIRMED" }, include: { employee: true } });
      if (!rep) throw new PaymentError("documentNotFound", { index });
      const open = dec(rep.total).minus(dec(rep.paidTotal));
      if (!amount.isPositive() || amount.greaterThan(open)) throw new PaymentError("overpaid", { index, number: rep.number ?? "", open: open.toFixed(2) });
      if (!rep.employee.bankAccount) throw new PaymentError("partyRequired", { index, number: rep.number ?? "" });
      lines.push({
        expenseReportId: rep.id,
        partyName: rep.employeeName,
        iban: rep.employee.bankAccount,
        amount: amount.toFixed(2),
        description: `Kuluaruanne ${rep.number ?? ""}`.trim(),
        sortOrder: index,
      });
    }
  }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const order = await tx.paymentOrder.create({
    data: {
      companyId,
      messageId: `LS${stamp}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      bankAccountId: bank.id,
      executionDate: input.executionDate,
      total: sum(lines.map((l) => dec(l.amount as string))).toFixed(2),
      createdById: userId,
    },
  });
  await tx.paymentOrderLine.createMany({ data: lines.map((l) => ({ ...l, companyId, orderId: order.id })) });
  return order.id;
}

export async function paymentOrderXml(tx: Tx, companyId: string, orderId: string) {
  const order = await tx.paymentOrder.findFirst({ where: { companyId, id: orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!order) throw new PaymentError("paymentNotFound");
  const [bank, company, invoices] = await Promise.all([
    tx.bankAccount.findFirstOrThrow({ where: { companyId, id: order.bankAccountId } }),
    tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, regCode: true } }),
    tx.purchaseInvoice.findMany({ where: { companyId, id: { in: order.lines.map((l) => l.purchaseInvoiceId).filter((x): x is string => Boolean(x)) } }, select: { id: true, number: true } }),
  ]);
  const numbers = new Map(invoices.map((i) => [i.id, i.number]));
  return {
    fileName: `maksekorraldus-${toISODate(order.executionDate)}-${order.messageId.slice(-4)}.xml`,
    xml: buildPain001({
      messageId: order.messageId,
      createdAt: order.createdAt,
      executionDate: toISODate(order.executionDate),
      debtor: { name: company.name, iban: bank.iban!, bic: bank.bic, regCode: company.regCode },
      payments: order.lines.map((l, i) => ({
        endToEndId: (l.purchaseInvoiceId && numbers.get(l.purchaseInvoiceId)) || `${order.messageId.slice(-8)}-${i + 1}`,
        amount: dec(l.amount).toFixed(2),
        creditorName: l.partyName,
        creditorIban: l.iban,
        referenceNumber: l.referenceNumber,
        description: l.description,
      })),
    }),
  };
}

/** Märgib maksekorralduse tasutuks: iga rea kohta kinnitatud väljamakse täitmise kuupäevaga. */
export async function markPaymentOrderPaid(tx: Tx, companyId: string, userId: string | null, orderId: string) {
  const order = await tx.paymentOrder.findFirst({ where: { companyId, id: orderId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!order) throw new PaymentError("paymentNotFound");
  if (order.status === "PAID") return [];
  const ids: string[] = [];
  for (const l of order.lines) {
    const inv = l.purchaseInvoiceId ? await tx.purchaseInvoice.findFirst({ where: { companyId, id: l.purchaseInvoiceId }, select: { supplierId: true } }) : null;
    const rep = l.expenseReportId ? await tx.expenseReport.findFirst({ where: { companyId, id: l.expenseReportId }, select: { employeeId: true } }) : null;
    const paymentId = await savePayment(tx, companyId, userId, {
      direction: "OUT",
      bankAccountId: order.bankAccountId,
      date: order.executionDate,
      amount: dec(l.amount).toFixed(2),
      partyType: inv ? "SUPPLIER" : "EMPLOYEE",
      supplierId: inv?.supplierId ?? null,
      employeeId: rep?.employeeId ?? null,
      partyIban: l.iban,
      referenceNumber: l.referenceNumber,
      description: l.description,
      paymentOrderId: order.id,
      allocations: [
        l.purchaseInvoiceId
          ? { type: "PURCHASE_INVOICE", purchaseInvoiceId: l.purchaseInvoiceId, amount: dec(l.amount).toFixed(2) }
          : { type: "EXPENSE_REPORT", expenseReportId: l.expenseReportId, amount: dec(l.amount).toFixed(2) },
      ],
    });
    await confirmPayment(tx, companyId, userId, paymentId);
    ids.push(paymentId);
  }
  await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
  return ids;
}
