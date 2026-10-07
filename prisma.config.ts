import "dotenv/config";
import { defineConfig } from "prisma/config";
import { migrationDatabaseUrl } from "./src/lib/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` (postinstall) ei vaja andmebaasi. Migratsioonide eel kontrollib
    // scripts/check-database-url.ts, et päris aadress on olemas.
    url: migrationDatabaseUrl() ?? "postgresql://localhost:5432/placeholder",
  },
});
