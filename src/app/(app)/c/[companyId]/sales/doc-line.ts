import type { DocLine } from "./document-editor";

/** Uus tühi dokumendirida. Eraldi moodulis, et seda saaks kasutada ka serverlehtedel. */
let seq = 0;
export const newLine = (patch: Partial<DocLine> = {}): DocLine => ({
  key: `d${Date.now().toString(36)}${(seq++).toString(36)}`,
  itemId: "",
  code: "",
  description: "",
  quantity: "1",
  unit: "",
  unitPrice: "",
  discountPct: "",
  vatRateId: "",
  accountId: "",
  departmentId: "",
  dims: {},
  unitCost: "",
  prepaymentInvoiceId: "",
  ...patch,
});
