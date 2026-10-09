import "server-only";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { formatIban } from "@/lib/iban";
import { formatDate } from "@/lib/dates";
import { dec, formatMoney } from "@/lib/money";
import { isLocale } from "@/i18n/config";
import { calculateDocument, type VatKindLike } from "@/lib/sales/calc";
import { customerAddress } from "@/server/services/sales";
import { renderSalesDocumentPdf, type PdfDocumentData } from "@/server/pdf/sales-document";

/**
 * Müügidokumendi PDF-i andmed dokumendi (kliendi) keeles. Kasutavad PDF-i allalaadimine ja
 * e-postiga saatmine.
 */

type DocLine = {
  code: string | null;
  description: string;
  quantity: { toString(): string };
  unit: string | null;
  unitPrice: { toString(): string };
  discountPct: { toString(): string };
  vatRateId: string | null;
  vatPct: { toString(): string };
  unitCost: { toString(): string } | null;
  netAmount: { toString(): string };
  vatAmount: { toString(): string };
};

function trimNumber(value: { toString(): string }, maxPlaces: number, locale: string) {
  const d = dec(value.toString());
  const places = Math.min(maxPlaces, Math.max(0, d.decimalPlaces()));
  return formatMoney(d, locale, { scale: places });
}

/** Ühikuhind: vähemalt 2, kuni 4 komakohta. */
function priceText(value: { toString(): string }, locale: string) {
  const d = dec(value.toString());
  return formatMoney(d, locale, { scale: Math.max(2, Math.min(4, d.decimalPlaces())) });
}

type T = (key: string, values?: Record<string, string | number>) => string;

async function loadCompany(companyId: string) {
  return db.company.findUniqueOrThrow({ where: { id: companyId } });
}

/** Arve pangarekvisiidid: arvel näidatavad pangakontod, muidu arve seadistuse vaba tekst. */
export async function bankDetails(companyId: string, fallback: string | null) {
  const banks = await db.bankAccount.findMany({
    where: { companyId, kind: "BANK", active: true, showOnInvoice: true, iban: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { name: true, iban: true },
  });
  if (banks.length === 0) return fallback;
  return banks.map((b) => `${b.name} ${formatIban(b.iban!)}`).join("\n");
}

async function buildData(
  companyId: string,
  doc: {
    kind: "INVOICE" | "CREDIT" | "PREPAYMENT" | "QUOTE";
    isInterest?: boolean;
    number: string;
    locale: string;
    currency: string;
    pricesIncludeVat: boolean;
    customerName: string;
    customerRegCode: string | null;
    customerVatNumber: string | null;
    customerAddress: string | null;
    notes: string | null;
    total: { toString(): string };
    lines: DocLine[];
    meta: (t: T, fmt: (d: Date) => string) => Array<[string, string]>;
  },
): Promise<PdfDocumentData> {
  const locale = isLocale(doc.locale) ? doc.locale : "et";
  const t = await getTranslations({ locale, namespace: "pdf" });
  const company = await loadCompany(companyId);
  const vatRates = await db.vatRate.findMany({
    where: { companyId, id: { in: [...new Set(doc.lines.map((l) => l.vatRateId).filter(Boolean) as string[])] } },
    select: { id: true, kind: true, invoiceNote: true },
  });
  const vatById = new Map(vatRates.map((v) => [v.id, v]));
  const money = (v: { toString(): string }) => formatMoney(v.toString(), locale);

  // Kokkuvõte arvutatakse salvestatud ridadest samade reeglitega nagu arve kinnitamisel
  const calc = calculateDocument(
    doc.lines.map((l) => ({
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
      vatRateId: l.vatRateId,
      vatPct: l.vatPct.toString(),
      vatKind: (l.vatRateId ? vatById.get(l.vatRateId)?.kind : null) as VatKindLike | null,
      unitCost: l.unitCost?.toString() ?? null,
    })),
    { pricesIncludeVat: doc.pricesIncludeVat },
  );

  const vatLabel = (l: DocLine) => {
    const kind = l.vatRateId ? vatById.get(l.vatRateId)?.kind : null;
    if (!kind || kind === "NOT_TAXABLE" || kind === "MARGIN") return "–";
    if (kind === "TAXABLE") return `${trimNumber(l.vatPct, 2, locale)}%`;
    return "0%";
  };

  const vatRows = calc.vatSummary.filter((s) => s.kind === "TAXABLE" && !s.vat.isZero());
  const notes = [
    ...new Set(
      vatRates
        .filter((v) => v.kind !== "TAXABLE" && v.invoiceNote)
        .map((v) => v.invoiceNote!),
    ),
  ];
  if (doc.notes) notes.unshift(doc.notes);

  const title = doc.isInterest
    ? t("titleInterest")
    : { INVOICE: t("titleInvoice"), CREDIT: t("titleCredit"), PREPAYMENT: t("titlePrepayment"), QUOTE: t("titleQuote") }[doc.kind];
  const address = customerAddress(company);
  return {
    title,
    number: doc.number,
    accent: /^#[0-9a-fA-F]{6}$/.test(company.invoiceAccent) ? company.invoiceAccent : "#0f5c55",
    company: {
      name: company.name,
      regCode: company.regCode,
      vatNumber: company.vatNumber,
      address,
      email: company.email,
      phone: company.phone,
      website: company.website,
      bankDetails: await bankDetails(companyId, company.invoiceBankDetails),
      footer: company.invoiceFooter,
    },
    customer: {
      name: doc.customerName,
      regCode: doc.customerRegCode,
      vatNumber: doc.customerVatNumber,
      address: doc.customerAddress,
    },
    meta: doc.meta(t, (d) => formatDate(d, locale)),
    lines: doc.lines.map((l, i) => ({
      code: l.code,
      description: l.description,
      quantity: trimNumber(l.quantity, 4, locale),
      unit: l.unit,
      unitPrice: priceText(l.unitPrice, locale),
      discount: dec(l.discountPct.toString()).isZero() ? null : `${trimNumber(l.discountPct, 2, locale)}%`,
      vat: vatLabel(l),
      amount: money(calc.lines[i]!.amount),
    })),
    showDiscount: doc.lines.some((l) => !dec(l.discountPct.toString()).isZero()),
    vatSummary: vatRows.map((s) => [t("vatBase", { pct: trimNumber(s.vatPct, 2, locale) }), money(s.base)]),
    totals: [
      [t("net"), money(calc.net)],
      ...vatRows.map((s): [string, string] => [t("vatAt", { pct: trimNumber(s.vatPct, 2, locale) }), money(s.vat)]),
    ],
    payable: [doc.kind === "QUOTE" ? t("total") : doc.kind === "CREDIT" ? t("creditTotal") : t("payable"), `${money(doc.total)} ${doc.currency}`],
    notes,
    labels: {
      seller: t("seller"),
      buyer: doc.kind === "QUOTE" ? t("recipient") : t("buyer"),
      regCode: t("regCode"),
      vatNumber: t("vatNumber"),
      code: t("code"),
      description: t("description"),
      quantity: t("quantity"),
      unit: t("unit"),
      price: doc.pricesIncludeVat ? t("priceWithVat") : t("price"),
      discount: t("discount"),
      vat: t("vat"),
      amount: t("amount"),
      bank: t("bank"),
      page: t("page"),
    },
  };
}

export async function invoicePdf(companyId: string, invoiceId: string) {
  const invoice = await db.salesInvoice.findFirst({
    where: { companyId, id: invoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, creditOf: { select: { number: true } } },
  });
  if (!invoice) return null;
  const number = invoice.number ?? "—";
  const data = await buildData(companyId, {
    kind: invoice.type,
    isInterest: invoice.isInterest,
    number,
    locale: invoice.locale,
    currency: invoice.currency,
    pricesIncludeVat: invoice.pricesIncludeVat,
    customerName: invoice.customerName,
    customerRegCode: invoice.customerRegCode,
    customerVatNumber: invoice.customerVatNumber,
    customerAddress: invoice.customerAddress,
    notes: invoice.notes,
    total: invoice.total,
    lines: invoice.lines,
    meta: (t, fmt) => {
      const rows: Array<[string, string]> = [[t("date"), fmt(invoice.date)]];
      if (invoice.type !== "CREDIT") rows.push([t("dueDate"), fmt(invoice.dueDate)]);
      if (invoice.deliveryDate) rows.push([t("deliveryDate"), fmt(invoice.deliveryDate)]);
      if (invoice.referenceNumber && invoice.type !== "CREDIT") rows.push([t("referenceNumber"), invoice.referenceNumber]);
      if (invoice.creditOf?.number) rows.push([t("creditOf"), invoice.creditOf.number]);
      if (invoice.yourReference) rows.push([t("yourReference"), invoice.yourReference]);
      if (invoice.type === "INVOICE" && invoice.lateInterestPct && !invoice.lateInterestPct.isZero()) {
        const locale = isLocale(invoice.locale) ? invoice.locale : "et";
        rows.push([t("lateInterest"), t("lateInterestValue", { pct: trimNumber(invoice.lateInterestPct, 3, locale) })]);
      }
      return rows;
    },
  });
  const t = await getTranslations({ locale: isLocale(invoice.locale) ? invoice.locale : "et", namespace: "pdf" });
  const prefix = invoice.isInterest ? t("fileInterest") : { INVOICE: t("fileInvoice"), CREDIT: t("fileCredit"), PREPAYMENT: t("filePrepayment") }[invoice.type];
  return {
    buffer: await renderSalesDocumentPdf(data),
    filename: `${prefix}-${number.replace(/[^\w.-]+/g, "_")}.pdf`,
    invoice,
    title: data.title,
  };
}

export async function quotePdf(companyId: string, quoteId: string) {
  const quote = await db.quote.findFirst({ where: { companyId, id: quoteId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!quote) return null;
  const data = await buildData(companyId, {
    kind: "QUOTE",
    number: quote.number,
    locale: quote.locale,
    currency: quote.currency,
    pricesIncludeVat: quote.pricesIncludeVat,
    customerName: quote.customerName,
    customerRegCode: quote.customerRegCode,
    customerVatNumber: quote.customerVatNumber,
    customerAddress: quote.customerAddress,
    notes: quote.notes,
    total: quote.total,
    lines: quote.lines,
    meta: (t, fmt) => {
      const rows: Array<[string, string]> = [[t("date"), fmt(quote.date)]];
      if (quote.validUntil) rows.push([t("validUntil"), fmt(quote.validUntil)]);
      if (quote.yourReference) rows.push([t("yourReference"), quote.yourReference]);
      return rows;
    },
  });
  const t = await getTranslations({ locale: isLocale(quote.locale) ? quote.locale : "et", namespace: "pdf" });
  return {
    buffer: await renderSalesDocumentPdf(data),
    filename: `${t("fileQuote")}-${quote.number.replace(/[^\w.-]+/g, "_")}.pdf`,
    quote,
    title: data.title,
  };
}
