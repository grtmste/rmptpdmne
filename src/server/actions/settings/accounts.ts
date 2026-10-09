"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { findReportLine, reportLinesForType } from "@/lib/accounting/report-lines";
import { codeSchema, idSchema, requiredText } from "@/lib/validation";
import { ensureCompanyDefaults } from "@/server/services/company-setup";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

/** Loob olemasolevale ettevõttele puuduva vaikeseadistuse (kontoplaan, KM jne). */
export const initializeCompanySetup = companyAction(
  { module: "settings", level: "edit", schema: z.object({}) },
  async (_input, ctx) => {
    const result = await db.$transaction((tx) => ensureCompanyDefaults(tx, ctx.company.id, { userId: ctx.user.id }), {
      timeout: 20_000,
    });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "settings.initialize",
      entityType: "Company",
      entityId: ctx.company.id,
      after: result,
    });
    revalidatePath(`/c/${ctx.company.id}`, "layout");
    return result;
  },
);

const accountSchema = z.object({
  id: idSchema.optional(),
  code: codeSchema(10),
  name: requiredText(150),
  nameEn: z.string().trim().max(150).optional(),
  type: z.enum(ACCOUNT_TYPES),
  kind: z.enum(["DETAIL", "SUMMARY"]),
  reportLine: z.string().max(40).optional(),
  costFunction: z.enum(["", "COST_OF_SALES", "DISTRIBUTION", "ADMIN"]).optional(),
  defaultVatRateId: idSchema.optional().or(z.literal("")),
  vatTurnover: z.enum(["NONE", "SALES", "PURCHASE"]),
  isPaymentMethod: z.boolean(),
  requiresDepartment: z.boolean(),
  requiredDimensionIds: z.array(idSchema).max(20),
  showOnDashboard: z.boolean(),
  active: z.boolean(),
});

export const saveAccount = companyAction({ module: "settings", level: "edit", schema: accountSchema }, async (input, ctx) => {
  if (input.reportLine) {
    const line = findReportLine(input.reportLine);
    if (!line || !reportLinesForType(input.type).some((l) => l.code === line.code)) throw new ActionError("reportLineMismatch");
  }
  if (input.defaultVatRateId) {
    const vat = await ctx.cdb.vatRate.findFirst({ where: { id: input.defaultVatRateId } });
    if (!vat) throw new ActionError("notFound");
  }
  if (input.requiredDimensionIds.length) {
    const count = await ctx.cdb.dimension.count({ where: { id: { in: input.requiredDimensionIds } } });
    if (count !== input.requiredDimensionIds.length) throw new ActionError("notFound");
  }
  const data = {
    code: input.code,
    name: input.name,
    nameEn: input.nameEn || null,
    type: input.type,
    kind: input.kind,
    reportLine: input.reportLine || null,
    costFunction: input.type === "EXPENSE" && input.costFunction ? input.costFunction : null,
    defaultVatRateId: input.defaultVatRateId || null,
    vatTurnover: input.vatTurnover,
    isPaymentMethod: input.isPaymentMethod,
    requiresDepartment: input.requiresDepartment,
    requiredDimensionIds: input.requiredDimensionIds,
    showOnDashboard: input.showOnDashboard,
    active: input.active,
  };

  if (input.id) {
    const before = await ctx.cdb.glAccount.findFirst({ where: { id: input.id } });
    if (!before) throw new ActionError("notFound");
    // Süsteemse konto tüüpi ja aktiivsust muuta ei saa (programm kasutab neid automaatsetes kannetes)
    if (before.role && (before.type !== input.type || !input.active || input.kind !== "DETAIL")) {
      throw new ActionError("systemAccount");
    }
    // Kasutusel konto tüüpi ei muudeta (aruanded läheksid sassi)
    if (before.type !== input.type || before.kind !== input.kind) {
      const used = await ctx.cdb.journalLine.count({ where: { accountId: before.id } });
      if (used > 0) throw new ActionError("accountInUseType");
    }
    const after = await ctx.cdb.glAccount.update({ where: { id: input.id }, data });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "account.update",
      entityType: "GlAccount",
      entityId: after.id,
      before: { ...before, requiredDimensionIds: before.requiredDimensionIds.join(",") },
      after: { ...after, requiredDimensionIds: after.requiredDimensionIds.join(",") },
    });
  } else {
    const created = await ctx.cdb.glAccount.create({
      data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id },
    });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "account.create",
      entityType: "GlAccount",
      entityId: created.id,
      after: { code: input.code, name: input.name, type: input.type },
    });
  }
  revalidatePath(`/c/${ctx.company.id}/settings/accounts`);
});

export const deleteAccount = companyAction(
  { module: "settings", level: "edit", schema: z.object({ id: idSchema }) },
  async ({ id }, ctx) => {
    const account = await ctx.cdb.glAccount.findFirst({ where: { id } });
    if (!account) throw new ActionError("notFound");
    if (account.role) throw new ActionError("systemAccount");
    if ((await ctx.cdb.journalLine.count({ where: { accountId: id } })) > 0) throw new ActionError("inUse");
    await ctx.cdb.glAccount.delete({ where: { id } });
    await audit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "account.delete",
      entityType: "GlAccount",
      entityId: id,
      before: { code: account.code, name: account.name },
    });
    revalidatePath(`/c/${ctx.company.id}/settings/accounts`);
  },
);
