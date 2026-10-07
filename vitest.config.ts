import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // "server-only" viskab väljaspool Next.js-i vea; testides asendame tühja mooduliga.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integratsioonitestid jagavad ühte andmebaasi.
    fileParallelism: false,
    setupFiles: ["tests/support/setup.ts"],
  },
});
