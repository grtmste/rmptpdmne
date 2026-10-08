import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./password-policy";
import { parseISODate } from "./accounting/dates";
import { parseMoneyInput } from "./money";

/**
 * Ühised Zod skeemid. Veateated on i18n võtmed nimeruumis `validation`
 * (kliendis tõlgitakse `useTranslations("validation")` kaudu).
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "email" }).max(254, { error: "tooLong" }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: "passwordTooShort" })
  .max(200, { error: "tooLong" });

export const requiredText = (max = 200) =>
  z.string().trim().min(1, { error: "required" }).max(max, { error: "tooLong" });

export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    .optional()
    .transform((v) => (v ? v : null));

/** Eesti äriregistri kood: 8 numbrit. Välismaise ettevõtte puhul vabam kuju. */
export const regCodeSchema = z
  .string()
  .trim()
  .max(20, { error: "tooLong" })
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, "") : null));

/** KMKR number: riigikood + numbrid, nt EE123456789. */
export const vatNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, "") : null))
  .refine((v) => v === null || /^[A-Z]{2}[0-9A-Z+*.]{2,13}$/.test(v), { error: "vatNumber" });

/** Turvaline sisemine suunamise aadress (väldib open redirect'i). */
export function safeRedirect(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/** Kuupäev kujul YYYY-MM-DD → Date (UTC kesköö). */
export const dateSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = parseISODate(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "date" });
      return z.NEVER;
    }
    return d;
  });

export const optionalDateSchema = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = parseISODate(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "date" });
      return z.NEVER;
    }
    return d;
  });

/** Rahasumma kasutaja sisendist ("1 234,50") → string "1234.50". Tühi = "0.00". */
export const moneyInputSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return "0.00";
    const d = parseMoneyInput(v);
    if (!d || d.decimalPlaces() > 2) {
      ctx.addIssue({ code: "custom", message: "amount" });
      return z.NEVER;
    }
    return d.toFixed(2);
  });

/** Protsent 0–100, kuni 2 komakohta. */
export const percentSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const d = parseMoneyInput(v);
    if (!d || d.isNegative() || d.greaterThan(100) || d.decimalPlaces() > 2) {
      ctx.addIssue({ code: "custom", message: "percent" });
      return z.NEVER;
    }
    return d.toFixed(2);
  });

/** Kood (konto, dimensiooni väärtus, osakond): tähed, numbrid, -, _, . */
export const codeSchema = (max = 20) =>
  z
    .string()
    .trim()
    .min(1, { error: "required" })
    .max(max, { error: "tooLong" })
    .regex(/^[0-9A-Za-zÕÄÖÜõäöü._\-/]+$/, { error: "code" });

export const idSchema = z.string().min(1).max(64);

/**
 * Kümnendarv kasutaja sisendist (kogus, ühikuhind) → string. Tühi = "0".
 * `places` – lubatud komakohtade arv, `negative` – kas negatiivne on lubatud.
 */
export const decimalInputSchema = (places: number, opts: { negative?: boolean; empty?: string } = {}) =>
  z
    .string()
    .trim()
    .max(40, { error: "tooLong" })
    .transform((v, ctx) => {
      if (v === "") return opts.empty ?? "0";
      const d = parseMoneyInput(v);
      if (!d || d.decimalPlaces() > places || (!opts.negative && d.isNegative()) || d.abs().greaterThan("1e13")) {
        ctx.addIssue({ code: "custom", message: "amount" });
        return z.NEVER;
      }
      return d.toString();
    });

/** Valikuline viide teisele kirjele: tühi string → null. */
export const optionalIdSchema = z
  .string()
  .max(64)
  .optional()
  .transform((v) => (v ? v : null));
