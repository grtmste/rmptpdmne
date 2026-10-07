import "dotenv/config";
import { defineConfig } from "prisma/config";
import { DATABASE_URL_HELP, migrationDatabaseUrl } from "./src/lib/database-url";

const url = migrationDatabaseUrl();

// Vercelis peab aadress olemas olema (build käivitab migratsioonid). Mujal lubame `prisma generate`
// käivitada ka ilma andmebaasita.
if (!url && process.env.VERCEL) {
  throw new Error(DATABASE_URL_HELP);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: url ?? "postgresql://localhost:5432/placeholder",
  },
});
