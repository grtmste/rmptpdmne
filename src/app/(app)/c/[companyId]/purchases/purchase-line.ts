export type PurchaseLine = {
  key: string;
  itemId: string;
  code: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  vatRateId: string;
  accountId: string;
  departmentId: string;
  dims: Record<string, string>;
};

let seq = 0;
export const newPurchaseLine = (patch: Partial<PurchaseLine> = {}): PurchaseLine => ({
  key: `p${Date.now().toString(36)}${(seq++).toString(36)}`,
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
  ...patch,
});

const plain = (v: { toString(): string }) => {
  const s = v.toString();
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** Andmebaasi rida → redaktori rida. */
export function toPurchaseLine(
  l: {
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
  },
  dimensionOf: Map<string, string>,
): PurchaseLine {
  return {
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
    dims: Object.fromEntries(l.dimensionValueIds.flatMap((id) => (dimensionOf.get(id) ? [[dimensionOf.get(id)!, id]] : []))),
  };
}

export const plainDecimal = plain;
