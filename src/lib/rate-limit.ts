import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: Date };

/**
 * Fikseeritud akna loendur Postgresis (tabel RateLimit). Üks atomaarne päring, seega töötab
 * ka mitme serverless-instantsi korral.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0]!;
  return { ok: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt: row.resetAt };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Auth-teekonna piirangud: IP kohta ja e-posti kohta. */
export async function limitAuthAttempt(kind: "login" | "register" | "magic", email?: string): Promise<boolean> {
  const ip = await clientIp();
  const byIp = await rateLimit(`${kind}:ip:${ip}`, 20, 15 * 60);
  if (!byIp.ok) return false;
  if (email) {
    const byEmail = await rateLimit(`${kind}:email:${email.toLowerCase()}`, 8, 15 * 60);
    if (!byEmail.ok) return false;
  }
  return true;
}
