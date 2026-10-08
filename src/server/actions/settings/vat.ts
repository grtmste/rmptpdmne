"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { validateVatPeriods } from "@/lib/accounting/vat";
import { toISODate } from "@/lib/accounting/dates";
import { codeSchema, dateSchema, idSchema, optionalDateSchema, percentSchema, requiredText } from "@/lib/validation";

const VAT_KINDS = ["TAXABLE", "ZERO_EXPORT", "ZERO_EU_GOODS", "EU_SERVICES", "EXEMPT", "REVERSE_CHARGE", "NOT_TAXABLE", "MARGIN"] as const;

const vatSchema = z.object({
  id: idSchema.optional(),
  code: codeSchema(16),
  name: requiredText(80),
  nameEn: z.string().trim().max(150).optional(),
  kind: z.enum(VAT_KINDS),
  deductiblePct: percentSchema,
  invoiceNote: z.string().trim().max(200).optional(),
  salesAccountId: idSchema.optional().or(z.literal("")),
  purchaseAccountId: idSchema.optional().or(z.literal("")),
  active: z.boolean(),
  periods: z
    .array(z.object({ rate: percentSchema, validFrom: dateSchema, validTo: optionalDateSchema }))
    .min(1, { error: "required" })
    .max(50),
});

export const saveVatRate = companyAction({ module: "settings", level: "edit", schema: vatSchema }, async (input, ctx) => {
  const issue = validateVatPeriods(input.periods);
  if (issue) throw new ActionError(`vatPeriods.${issue}`);
  for (const accountId of [input.salesAccountId, input.purchaseAccountId]) {
    if (accountId && !(await ctx.cdb.glAccount.findFirst({ where: { id: accountId } }))) throw new ActionError("notFound");
  }
  const data = {
    code: input.code,
    name: input.name,
    nameEn: input.nameEn || null,
    kind: input.kind,
    deductiblePct: input.deductiblePct,
    invoiceNote: input.invoiceNote || null,
    salesAccountId: input.salesAccountId || null,
    purchaseAccountId: input.purchaseAccountId || null,
    active: input.active,
  };
  const periodsText = input.periods.map((p) => `${p.rate}% ${toISODate(p.validFrom)}…${p.validTo ? toISODate(p.validTo) : ""}`).join("; ");

  await ctx.cdb.$transaction(async (tx) => {
    let id = input.id;
    let before: Record<string, unknown> | null = null;
    if (id) {
      const existing = await tx.vatRate.findFirst({ where: { id }, include: { periods: { orderBy: { validFrom: "asc" } } } });
      if (!existing) throw new ActionError("notFound");
      before = {
        ...existing,
        periods: existing.periods.map((p) => `${p.rate}% ${toISODate(p.validFrom)}…${p.validTo ? toISODate(p.validTo) : ""}`).join("; "),
      };
      await tx.vatRate.update({ where: { id }, data });
      await tx.vatRatePeriod.deleteMany({ where: { vatRateId: id } });
    } else {
      const count = await tx.vatRate.count();
      const created = await tx.vatRate.create({
        data: { ...data, companyId: ctx.company.id, sortOrder: count, createdById: ctx.user.id },
      });
      id = created.id;
    }
    await tx.vatRatePeriod.createMany({
      data: input.periods.map((p) => ({
        companyId: ctx.company.id,
        vatRateId: id!,
        rate: p.rate,
        validFrom: p.validFrom,
        validTo: p.validTo,
      })),
    });
    await audit(
      {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: input.id ? "vat.update" : "vat.create",
        entityType: "VatRate",
        entityId: id,
        before,
        after: { ...data, periods: periodsText },
      },
      tx,
    );
  });
  revalidatePath(`/c/${ctx.company.id}/settings/vat-rates`);
});

export const deleteVatRate = companyAction(
  { module: "settings", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const vat = await ctx.cdb.vatRate.findFirst({ where: { id } });
    if (!vat) throw new ActionError("notFound");
    if ((await ctx.cdb.journalLine.count({ where: { vatRateId: id } })) > 0) throw new ActionError("inUse");
    await ctx.cdb.vatRate.delete({ where: { id } });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "vat.delete",
      entityType: "VatRate",
      entityId: id,
      before: { code: vat.code, name: vat.name },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/vat-rates`);
  },
);
