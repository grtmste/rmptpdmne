import "server-only";
import type Decimal from "decimal.js";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { isLocale } from "@/i18n/config";
import { daysBetween } from "@/lib/reports/aging";
import { debtsAsOf, type OpenDocument } from "@/server/reports/debts";
import { customerAddress } from "@/server/services/sales";
import { renderStatementPdf } from "@/server/pdf/statement-document";
import { bankDetails } from "./documents";

/**
 * Maksemeeldetuletused (ainult tähtaja ületanud arved) ja saldoteatised (kogu saldo koos
 * ettemaksudega) kliendi kaupa seisuga, PDF ja e-kirja tekst kliendi keeles.
 */

export type StatementKind = "REMINDER" | "STATEMENT";

export type StatementEntry = {
  customerId: string;
  customerName: string;
  email: string | null;
  emailCc: string | null;
  locale: string;
  documents: OpenDocument[];
  prepayment: Decimal;
  /** Meeldetuletuses tähtaja ületanud summa, saldoteatises kogusaldo */
  total: Decimal;
  maxOverdueDays: number;
  lastSentAt: Date | null;
};

/** Kliendid, kellele meeldetuletus/saldoteatis kuulub (seisuga, meeldetuletusel min ületatud päevad). */
export async function statementCandidates(companyId: string, kind: StatementKind, asOf: Date, minOverdueDays = 1) {
  const debts = await debtsAsOf(db, companyId, "receivables", asOf);
  const ids = debts.rows.map((r) => r.partyKey.replace(/^CUSTOMER:/, ""));
  const customers = await db.customer.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, name: true, email: true, emailCc: true, locale: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  const sent = await db.emailLog.groupBy({
    by: ["documentId"],
    where: { companyId, documentType: kind === "REMINDER" ? "Reminder" : "Statement", documentId: { in: ids }, status: "SENT" },
    _max: { createdAt: true },
  });
  const lastSent = new Map(sent.map((x) => [x.documentId, x._max.createdAt]));
  const out: StatementEntry[] = [];
  for (const r of debts.rows) {
    const id = r.partyKey.replace(/^CUSTOMER:/, "");
    const c = byId.get(id);
    if (!c) continue;
    const overdue = (d: OpenDocument) => daysBetween(d.dueDate, asOf);
    const documents =
      kind === "REMINDER" ? r.documents.filter((d) => d.openBase.greaterThan(0) && overdue(d) >= minOverdueDays) : r.documents;
    const total = kind === "REMINDER" ? documents.reduce((s, d) => s.plus(d.openBase), dec(0)) : r.total;
    if (kind === "REMINDER" && documents.length === 0) continue;
    if (kind === "STATEMENT" && total.isZero() && documents.length === 0) continue;
    out.push({
      customerId: id,
      customerName: c.name,
      email: c.email,
      emailCc: c.emailCc,
      locale: c.locale,
      documents,
      prepayment: kind === "STATEMENT" ? r.prepayment : dec(0),
      total,
      maxOverdueDays: Math.max(0, ...documents.map(overdue)),
      lastSentAt: lastSent.get(id) ?? null,
    });
  }
  return out;
}

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/** E-kirja teema ja sisu (ettevõtte oma tekst või vaikimisi tekst kliendi keeles). */
export async function statementEmail(companyId: string, kind: StatementKind, entry: StatementEntry, asOf: Date) {
  const locale = isLocale(entry.locale) ? entry.locale : "et";
  const t = await getTranslations({ locale, namespace: "statementEmail" });
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, reminderText: true, statementText: true } });
  const values = { company: company.name, customer: entry.customerName, total: `${formatMoney(entry.total, locale)} EUR`, date: formatDate(asOf, locale) };
  const custom = kind === "REMINDER" ? company.reminderText : company.statementText;
  const body = custom ? fill(custom, values) : [t("greeting"), t(kind === "REMINDER" ? "reminderBody" : "statementBody", values), t("closing", values)].join("\n\n");
  return { subject: t(kind === "REMINDER" ? "reminderSubject" : "statementSubject", values), body };
}

export async function statementPdf(companyId: string, kind: StatementKind, entry: StatementEntry, asOf: Date) {
  const locale = isLocale(entry.locale) ? entry.locale : "et";
  const t = await getTranslations({ locale, namespace: "statementPdf" });
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      regCode: true,
      email: true,
      phone: true,
      invoiceAccent: true,
      invoiceBankDetails: true,
      addressStreet: true,
      addressCity: true,
      addressPostalCode: true,
      addressCounty: true,
      countryCode: true,
    },
  });
  const customer = await db.customer.findFirstOrThrow({
    where: { companyId, id: entry.customerId },
    select: { name: true, regCode: true, addressStreet: true, addressCity: true, addressPostalCode: true, addressCounty: true, countryCode: true },
  });
  const m = (v: Decimal) => formatMoney(v, locale);
  const fmt = (d: Date) => formatDate(d, locale);
  const openSum = entry.documents.reduce((s, d) => s.plus(d.openBase), dec(0));
  const isReminder = kind === "REMINDER";
  const buffer = await renderStatementPdf({
    title: t(isReminder ? "titleReminder" : "titleStatement"),
    accent: /^#[0-9a-fA-F]{6}$/.test(company.invoiceAccent) ? company.invoiceAccent : "#0f5c55",
    company: {
      name: company.name,
      address: customerAddress(company),
      regCode: company.regCode,
      email: company.email,
      phone: company.phone,
      bankDetails: await bankDetails(companyId, company.invoiceBankDetails),
    },
    customer: { name: customer.name, regCode: customer.regCode, address: customerAddress(customer) },
    meta: [
      [t("asOf"), fmt(asOf)],
      [t("documents"), String(entry.documents.length)],
    ],
    intro: t(isReminder ? "introReminder" : "introStatement", { date: fmt(asOf) }),
    rows: entry.documents.map((d) => {
      const overdue = daysBetween(d.dueDate, asOf);
      return {
        number: d.number,
        date: fmt(d.date),
        dueDate: fmt(d.dueDate),
        total: `${m(d.total)}${d.currency !== "EUR" ? ` ${d.currency}` : ""}`,
        open: m(d.openBase),
        overdue: overdue > 0 ? t("overdueDays", { days: overdue }) : "",
      };
    }),
    totals: [
      [t("openTotal"), m(openSum)],
      ...(entry.prepayment.isZero() ? [] : [[t("prepayment"), m(entry.prepayment.negated())] as [string, string]]),
    ],
    payable: [t(isReminder ? "payable" : "balance"), `${m(entry.total)} EUR`],
    confirmation: isReminder
      ? null
      : { text: t("confirmText", { date: fmt(asOf), company: company.name }), agree: t("agree"), disagree: t("disagree"), signature: t("signature") },
    labels: {
      buyer: t("customer"),
      regCode: t("regCode"),
      number: t("number"),
      date: t("date"),
      dueDate: t("dueDate"),
      total: t("total"),
      open: t("open"),
      overdue: t("overdue"),
      bank: t("bank"),
      page: t("page"),
    },
  });
  const slug = entry.customerName.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  return { buffer, filename: `${t(isReminder ? "fileReminder" : "fileStatement")}-${slug}.pdf` };
}
