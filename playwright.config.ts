import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "et-EE",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
