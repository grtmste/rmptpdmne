import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // generate ei vaja andmebaasi; migratsioonid vajavad päris DATABASE_URL-i
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder",
  },
});
