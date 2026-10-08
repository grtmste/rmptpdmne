"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, companyAction } from "@/lib/action";
import { audit } from "@/lib/audit";
import { parseISODate } from "@/lib/accounting/dates";
import { CURRENCIES, ECB_90D_URL, parseEcbXml } from "@/lib/currencies";
import { dateSchema } from "@/lib/validation";
import { parseMoneyInput } from "@/lib/money";

const currencySchema = z.object({ code: z.enum(CURRENCIES) });

export const addCurrency = companyAction({ module: "settings", level: "edit", schema: currencySchema }, async ({ code }, ctx) => {
  if (code === "EUR") return;
  await ctx.cdb.companyCurrency.upsert({
    where: { companyId_code: { companyId: ctx.company.id, code } },
    create: { companyId: ctx.company.id, code },
    update: {},
  });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "currency.add", entityType: "CompanyCurrency", after: { code } });
  revalidatePath(`/c/${ctx.company.id}/settings/currencies`);
});

export const removeCurrency = companyAction({ module: "settings", level: "edit", schema: currencySchema }, async ({ code }, ctx) => {
  await ctx.cdb.companyCurrency.deleteMany({ where: { code } });
  await audit({ companyId: ctx.company.id, userId: ctx.user.id, action: "currency.remove", entityType: "CompanyCurrency", before: { code } });
  revalidatePath(`/c/${ctx.company.id}/settings/currencies`);
});

/** Laeb EKP viimase 90 päeva kursid. Kursid on ühised kõigile ettevõtetele. */
export const fetchEcbRates = companyAction({ module: "settings", level: "edit", schema: z.object({}) }, async (_input, ctx) => {
  let xml: string;
  try {
    const res = await fetch(ECB_90D_URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (e) {
    console.error("EKP kursside laadimine ebaõnnestus", e);
    throw new ActionError("ecbUnavailable");
  }
  const rates = parseEcbXml(xml);
  if (rates.length === 0) throw new ActionError("ecbUnavailable");
  const result = await db.exchangeRate.createMany({
    data: rates.map((r) => ({ currency: r.currency, date: parseISODate(r.date)!, rate: r.rate, source: "ECB" })),
    skipDuplicates: true,
  });
  revalidatePath(`/c/${ctx.company.id}/settings/currencies`);
  return { inserted: result.count, latest: rates[0]?.date ?? null };
});

const manualRateSchema = z.object({
  currency: z.enum(CURRENCIES),
  date: dateSchema,
  rate: z.string().trim(),
});

/** Käsitsi kurss (nt kui EKP kurssi pole). Kirjutab sama päeva kursi üle. */
export const saveExchangeRate = companyAction({ module: "settings", level: "edit", schema: manualRateSchema }, async (input, ctx) => {
  const rate = parseMoneyInput(input.rate);
  if (!rate || !rate.isPositive() || input.currency === "EUR") throw new ActionError("validation");
  await db.exchangeRate.upsert({
    where: { currency_date: { currency: input.currency, date: input.date } },
    create: { currency: input.currency, date: input.date, rate: rate.toFixed(6), source: "MANUAL" },
    update: { rate: rate.toFixed(6), source: "MANUAL" },
  });
  await audit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "exchangeRate.save",
    entityType: "ExchangeRate",
    after: { currency: input.currency, date: input.date.toISOString().slice(0, 10), rate: rate.toFixed(6) },
  });
  revalidatePath(`/c/${ctx.company.id}/settings/currencies`);
});
