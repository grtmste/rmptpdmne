import type { PrismaClient } from "@/lib/prisma";

/** Tühjendab testandmebaasi kõik tabelid (v.a migratsioonide tabel). */
export async function resetDatabase(db: PrismaClient) {
  const url = process.env.DATABASE_URL ?? "";
  if (!/test/.test(url)) {
    throw new Error("Integratsioonitestid tohivad käia ainult testandmebaasis (DATABASE_URL peab sisaldama 'test').");
  }
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
