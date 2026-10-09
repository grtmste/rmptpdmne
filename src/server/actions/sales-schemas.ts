import { z } from "zod";
import { decimalInputSchema, idSchema, optionalIdSchema, optionalText } from "@/lib/validation";

/** Müügidokumentide ühised valideerimisskeemid (arved, pakkumised, perioodilised arved). */
export const lineSchema = z.object({
  itemId: optionalIdSchema,
  code: optionalText(30),
  description: z.string().trim().max(1000, { error: "tooLong" }),
  quantity: decimalInputSchema(4, { negative: true }),
  unit: optionalText(20),
  unitPrice: decimalInputSchema(4, { negative: true }),
  discountPct: decimalInputSchema(2).refine((v) => Number(v) <= 100, { error: "percent" }),
  vatRateId: optionalIdSchema,
  accountId: optionalIdSchema,
  departmentId: optionalIdSchema,
  dimensionValueIds: z.array(idSchema).max(20).optional(),
  unitCost: decimalInputSchema(4, { empty: "" }).transform((v) => (v === "" ? null : v)),
  prepaymentInvoiceId: optionalIdSchema,
});

export const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: "currency" });

