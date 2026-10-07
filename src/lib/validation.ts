import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./password-policy";

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
