import "server-only";
import { headers } from "next/headers";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

type Json = Prisma.InputJsonValue;

export type AuditEntry = {
  companyId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/** Leiab muutunud väljad. Decimal/Date võrreldakse stringina. */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, Json>; after: Record<string, Json> } | null {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out = { before: {} as Record<string, Json>, after: {} as Record<string, Json> };
  let changed = false;
  for (const key of keys) {
    if (key === "updatedAt" || key === "createdAt") continue;
    const bv = normalize(b[key]);
    const av = normalize(a[key]);
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      changed = true;
      if (key in b) out.before[key] = bv;
      if (key in a) out.after[key] = av;
    }
  }
  return changed ? out : null;
}

function normalize(v: unknown): Json {
  if (v === undefined || v === null) return null as unknown as Json;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "toFixed" in v && typeof (v as { toFixed: unknown }).toFixed === "function") {
    return String(v);
  }
  return v as Json;
}

type AuditWriter = { auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown> } };

/**
 * Kirjutab audit logi. Anna kaasa transaktsiooni klient (`tx`), et logi ja muudatus
 * salvestuksid koos.
 */
export async function audit(entry: AuditEntry, client: AuditWriter = db) {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    // Väljaspool päringut (seed, cron) päiseid pole.
  }
  const diff = entry.before || entry.after ? diffRecords(entry.before, entry.after) : null;
  await client.auditLog.create({
    data: {
      companyId: entry.companyId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      diff: diff ?? undefined,
      ip,
      userAgent,
    },
  });
}
