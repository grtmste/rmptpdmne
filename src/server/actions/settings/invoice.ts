"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { decimalInputSchema, optionalText } from "@/lib/validation";

const schema = z.object({
  paymentTermDays: z.coerce.number().int().min(0, { error: "days" }).max(365, { error: "days" }),
  lateInterestPct: decimalInputSchema(3).refine((v) => Number(v) <= 10, { error: "percent" }),
  invoiceBankDetails: optionalText(500),
  invoiceFooter: optionalText(300),
  invoiceNote: optionalText(1000),
  invoiceAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: "color" }),
});

/** Arve seadistus: maksetähtaeg, viivis, pangarekvisiidid, jalus, märkus ja värv. */
export const updateInvoiceSettings = companyAction({ module: "settings", level: "edit", schema }, async (input, ctx) => {
  const before = await ctx.cdb.company.findFirstOrThrow({
    where: { id: ctx.company.id },
    select: { paymentTermDays: true, lateInterestPct: true, invoiceBankDetails: true, invoiceFooter: true, invoiceNote: true, invoiceAccent: true },
  });
  await ctx.cdb.company.update({ where: { id: ctx.company.id }, data: input });
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "company.invoiceSettings",
    entityType: "Company",
    entityId: ctx.company.id,
    before: { ...before, lateInterestPct: before.lateInterestPct.toString() },
    after: input,
  });
  revalidatePath(`/c/${ctx.company.id}/settings/invoice`);
});
