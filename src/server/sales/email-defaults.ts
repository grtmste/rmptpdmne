import "server-only";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isLocale } from "@/i18n/config";

export type EmailDraft = { to: string; cc: string; subject: string; body: string };

/** E-kirja vaikimisi tekst dokumendi (kliendi) keeles. */
export async function emailDefaults(
  companyId: string,
  doc: {
    type: "INVOICE" | "CREDIT" | "PREPAYMENT" | "QUOTE";
    number: string | null;
    locale: string;
    total: { toString(): string };
    currency: string;
    dueDate?: Date | null;
    validUntil?: Date | null;
    referenceNumber?: string | null;
  },
  customer: { email: string | null; emailCc: string | null } | null,
): Promise<EmailDraft> {
  const locale = isLocale(doc.locale) ? doc.locale : "et";
  const t = await getTranslations({ locale, namespace: "documentEmail" });
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
  const values = {
    number: doc.number ?? "",
    company: company.name,
    total: `${formatMoney(doc.total.toString(), locale)} ${doc.currency}`,
    dueDate: doc.dueDate ? formatDate(doc.dueDate, locale) : "",
    validUntil: doc.validUntil ? formatDate(doc.validUntil, locale) : "",
    reference: doc.referenceNumber ?? "",
  };
  const kind = doc.type === "QUOTE" ? "quote" : doc.type === "CREDIT" ? "credit" : doc.type === "PREPAYMENT" ? "prepayment" : "invoice";
  const body = [
    t("greeting"),
    t(`${kind}Body`, values),
    doc.type === "INVOICE" || doc.type === "PREPAYMENT" ? (values.reference ? t("paymentWithReference", values) : t("payment", values)) : null,
    doc.type === "QUOTE" && values.validUntil ? t("quoteValid", values) : null,
    t("closing", values),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    to: customer?.email ?? "",
    cc: customer?.emailCc ?? "",
    subject: t(`${kind}Subject`, values),
    body,
  };
}
