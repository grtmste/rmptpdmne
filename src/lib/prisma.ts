import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { DATABASE_URL_HELP, runtimeDatabaseUrl } from "./database-url";

export type { PrismaClient };

/** Loob Prisma kliendi. Eraldi failis, et testid saaksid seda ilma `server-only`-ta kasutada. */
export function createPrismaClient(connectionString = runtimeDatabaseUrl()): PrismaClient {
  if (!connectionString) {
    throw new Error(DATABASE_URL_HELP);
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}
