/**
 * Andmebaasi aadressi leidmine. Neoni Verceli integratsioon võib muutujad lisada eri nimedega
 * (ka eesliitega, nt STORAGE_DATABASE_URL), seega proovime levinumaid nimesid järjest.
 */

type Env = Record<string, string | undefined>;

const POOLED = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"];
const UNPOOLED = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NO_SSL"];

function first(names: string[], env: Env): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  // Eesliitega variandid, nt STORAGE_DATABASE_URL
  for (const name of names) {
    const key = Object.keys(env).find((k) => k.endsWith(`_${name}`) && !k.startsWith("TEST_") && env[k]);
    if (key) return env[key];
  }
  return undefined;
}

/** Rakenduse päringute jaoks (pooled ühendus, kui olemas). */
export function runtimeDatabaseUrl(env: Env = process.env): string | undefined {
  return first(POOLED, env) ?? first(UNPOOLED, env);
}

/** Migratsioonide jaoks (otseühendus, kui olemas – pooler ei sobi migratsioonidele). */
export function migrationDatabaseUrl(env: Env = process.env): string | undefined {
  return first(UNPOOLED, env) ?? first(POOLED, env);
}

export const DATABASE_URL_HELP =
  "Andmebaasi aadress puudub. Vercelis: Storage → Neon → Connect Project ja vali keskkondadeks " +
  "Production JA Preview; või lisa käsitsi Settings → Environment Variables → DATABASE_URL.";
