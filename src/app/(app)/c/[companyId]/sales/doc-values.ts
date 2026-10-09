import { toISODate } from "@/lib/accounting/dates";
import type { DocLine, DocValues } from "./document-editor";

type DbLine = {
  id: string;
  itemId: string | null;
  code: string | null;
  description: string;
  quantity: { toString(): string };
  unit: string | null;
  unitPrice: { toString(): string };
  discountPct: { toString(): string; isZero(): boolean };
  vatRateId: string | null;
  accountId: string | null;
  departmentId: string | null;
  dimensionValueIds: string[];
  unitCost: { toString(): string } | null;
  prepaymentInvoiceId?: string | null;
};

/** Kümnendarv vormi jaoks ilma liigsete nullideta ("10.5000" → "10.5"). */
const plain = (v: { toString(): string }) => {
  const s = v.toString();
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** Andmebaasi dokument → redaktori väärtused. Dimensioonid seotakse dimensiooni id järgi. */
export function toDocValues(
  doc: {
    customerId: string;
    date: Date;
    dueDate?: Date | null;
    validUntil?: Date | null;
    deliveryDate?: Date | null;
    currency: string;
    currencyRate?: { toString(): string } | null;
    pricesIncludeVat: boolean;
    yourReference: string | null;
    notes: string | null;
    warehouseId?: string | null;
    lines: DbLine[];
  },
  dimensionOf: Map<string, string>,
  opts: { keepRate?: boolean } = {},
): DocValues {
  return {
    customerId: doc.customerId,
    date: toISODate(doc.date),
    dueDate: doc.dueDate ? toISODate(doc.dueDate) : "",
    validUntil: doc.validUntil ? toISODate(doc.validUntil) : "",
    deliveryDate: doc.deliveryDate ? toISODate(doc.deliveryDate) : "",
    currency: doc.currency,
    currencyRate: opts.keepRate && doc.currencyRate && doc.currency !== "EUR" ? plain(doc.currencyRate) : "",
    pricesIncludeVat: doc.pricesIncludeVat,
    yourReference: doc.yourReference ?? "",
    notes: doc.notes ?? "",
    warehouseId: doc.warehouseId ?? "",
    lines: doc.lines.map(
      (l): DocLine => ({
        key: l.id,
        itemId: l.itemId ?? "",
        code: l.code ?? "",
        description: l.description,
        quantity: plain(l.quantity),
        unit: l.unit ?? "",
        unitPrice: plain(l.unitPrice),
        discountPct: l.discountPct.isZero() ? "" : plain(l.discountPct),
        vatRateId: l.vatRateId ?? "",
        accountId: l.accountId ?? "",
        departmentId: l.departmentId ?? "",
        dims: Object.fromEntries(
          l.dimensionValueIds.flatMap((id) => (dimensionOf.get(id) ? [[dimensionOf.get(id)!, id]] : [])),
        ),
        unitCost: l.unitCost ? plain(l.unitCost) : "",
        prepaymentInvoiceId: l.prepaymentInvoiceId ?? "",
      }),
    ),
  };
}
