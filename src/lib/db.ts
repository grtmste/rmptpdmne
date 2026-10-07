import "server-only";
import { createPrismaClient, type PrismaClient } from "./prisma";

/**
 * Süsteemne Prisma klient. Kasuta ainult identiteedi- ja ligipääsupäringuteks
 * (kasutajad, liikmesused, auth). Ettevõtte andmed loe ja kirjuta alati `companyDb()` kaudu.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
