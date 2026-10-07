"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { publicAction, ActionError, type ActionResult } from "@/lib/action";
import { hashPassword } from "@/lib/password";
import { limitAuthAttempt } from "@/lib/rate-limit";
import { emailSchema, passwordSchema, requiredText, safeRedirect } from "@/lib/validation";
import { createUserWithOrganization } from "@/server/services/accounts";
import { acceptInvitation, InvitationError } from "@/server/services/invitations";
import { getLocale } from "next-intl/server";

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "required" }).max(200),
  callbackUrl: z.string().optional(),
});

export async function loginWithPassword(input: z.input<typeof loginSchema>): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidCredentials" };
  const { email, password, callbackUrl } = parsed.data;
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (e) {
    if (e instanceof CredentialsSignin) {
      return { ok: false, error: e.code === "rate_limited" ? "rateLimited" : "invalidCredentials" };
    }
    if (e instanceof AuthError) return { ok: false, error: "invalidCredentials" };
    throw e;
  }
  return { ok: true, data: { redirectTo: safeRedirect(callbackUrl, "/") } };
}

const magicSchema = z.object({ email: emailSchema, callbackUrl: z.string().optional() });

/**
 * Saadab magic lingi. Vastus on alati sama, olenemata sellest, kas e-post on registreeritud.
 */
export async function requestMagicLink(input: z.input<typeof magicSchema>): Promise<ActionResult> {
  const parsed = magicSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation", fieldErrors: { email: ["email"] } };
  if (!(await limitAuthAttempt("magic", parsed.data.email))) return { ok: false, error: "rateLimited" };
  try {
    await signIn("resend", {
      email: parsed.data.email,
      redirect: false,
      redirectTo: safeRedirect(parsed.data.callbackUrl, "/"),
    });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    // Tundmatu e-post (AccessDenied) – vastame samamoodi nagu õnnestumisel.
  }
  return { ok: true, data: undefined };
}

const registerSchema = z.object({
  name: requiredText(120),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().max(200).optional(),
  inviteToken: z.string().max(200).optional(),
});

export const register = publicAction(registerSchema, async (input) => {
  if (!(await limitAuthAttempt("register", input.email))) throw new ActionError("rateLimited");
  const exists = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw new ActionError("emailTaken");

  const { user } = await createUserWithOrganization(db, {
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    locale: await getLocale(),
    organizationName: input.organizationName || input.name,
  });

  let redirectTo = "/companies/new";
  if (input.inviteToken) {
    try {
      const { companyId } = await acceptInvitation(db, input.inviteToken, user);
      redirectTo = `/c/${companyId}`;
    } catch (e) {
      if (!(e instanceof InvitationError)) throw e;
    }
  }

  await signIn("credentials", { email: input.email, password: input.password, redirect: false });
  return { redirectTo };
});

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
