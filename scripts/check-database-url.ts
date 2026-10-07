/**
 * Käivitub Verceli build'is enne migratsioone: kui andmebaasi aadress puudub, katkestab build'i
 * arusaadava veateatega (muidu prooviks Prisma ühenduda localhost'iga).
 */
import "dotenv/config";
import { DATABASE_URL_HELP, migrationDatabaseUrl } from "../src/lib/database-url";

if (!migrationDatabaseUrl()) {
  console.error(`\n✖ ${DATABASE_URL_HELP}\n`);
  process.exit(1);
}
console.info("✔ Andmebaasi aadress leitud.");
