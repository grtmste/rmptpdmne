import "server-only";
import { z } from "zod";
import { loadCompanyContext, getCurrentUser, type CompanyContext, type CurrentUser } from "@/server/session";
import { LedgerError } from "@/server/services/journal";
import { can, type Level, type Module } from "./permissions";

/**
 * Server Actionite ühine tulemus. `error` on i18n võti nimeruumis `errors`.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** Veateate muutujad (nt rea number, konto kood) */
      errorParams?: Record<string, string | number>;
    };

export class ActionError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "ActionError";
  }
}

function validationFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, error: "validation", fieldErrors };
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.code };
    if (e instanceof LedgerError) {
      const params = { ...e.meta };
      // Rea number kasutajale 1-st alates
      if (typeof params.index === "number") params.row = params.index + 1;
      return { ok: false, error: `ledger.${e.code}`, errorParams: params };
    }
    // Prisma: unikaalsuse rikkumine ja kasutuses oleva kirje kustutamine
    if (e && typeof e === "object" && "code" in e) {
      if (e.code === "P2002") return { ok: false, error: "duplicate" };
      if (e.code === "P2003" || e.code === "P2014") return { ok: false, error: "inUse" };
    }
    // Next.js redirect()/notFound() peavad edasi lendama.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "unexpected" };
  }
}

/**
 * Ettevõtte toimingu ümbris: sessioon → liikmesus → mooduli õigus → Zod → tegevus.
 * Tegevus saab `ctx.cdb` (ettevõttega piiratud klient) ja kasutaja.
 *
 *   export const updateX = companyAction({ module: "settings", level: "edit", schema }, async (input, ctx) => {...})
 *   // kliendis: await updateX(companyId, values)
 */
export function companyAction<S extends z.ZodType, R>(
  opts: { module: Module; level: Level; schema: S },
  handler: (input: z.output<S>, ctx: CompanyContext) => Promise<R>,
) {
  return async (companyId: string, input: z.input<S>): Promise<ActionResult<R>> => {
    if (typeof companyId !== "string" || companyId.length === 0) return { ok: false, error: "notFound" };
    const ctx = await loadCompanyContext(companyId);
    if (!ctx) return { ok: false, error: "notFound" };
    if (!can(ctx.membership, opts.module, opts.level)) return { ok: false, error: "forbidden" };
    const parsed = opts.schema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    return run(() => handler(parsed.data, ctx));
  };
}

/** Sisselogitud kasutaja toiming, mis ei ole seotud konkreetse ettevõttega. */
export function userAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.output<S>, user: CurrentUser) => Promise<R>,
) {
  return async (input: z.input<S>): Promise<ActionResult<R>> => {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "unauthenticated" };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    return run(() => handler(parsed.data, user));
  };
}

/** Avalik toiming (registreerimine jms) – ainult valideerimine. */
export function publicAction<S extends z.ZodType, R>(schema: S, handler: (input: z.output<S>) => Promise<R>) {
  return async (input: z.input<S>): Promise<ActionResult<R>> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    return run(() => handler(parsed.data));
  };
}
