import { test as setup } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Logib raamatupidajana ühe korra sisse ja salvestab sessiooni. Nii ei jookse testid
 * sisselogimise piirangusse (8 katset 15 minuti jooksul e-posti kohta).
 */
setup("raamatupidaja sisselogimine", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-post").fill("raamatupidaja@demo.ee");
  await page.getByLabel("Parool", { exact: true }).fill("demo-parool-123");
  await page.getByRole("button", { name: "Logi sisse" }).click();
  await page.waitForURL(/\/c\//);
  await page.context().storageState({ path: ACCOUNTANT_STATE });
});
