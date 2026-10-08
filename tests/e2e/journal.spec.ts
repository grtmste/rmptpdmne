import { expect, test } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

test.use({ storageState: ACCOUNTANT_STATE });

/**
 * Faas 2: käsitsi kanne klaviatuuriga, postitamine, storno, aruanded ja CSV.
 * Eeldab demoandmeid (pnpm db:seed).
 */
test("kanne, storno ja pearaamatu aruanded", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
  const base = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");

  await page.goto(`${base}/finance/journal/new`);
  const description = `E2E kanne ${Date.now()}`;
  await page.getByLabel("Selgitus", { exact: true }).fill(description);
  // Rida 1: konto koodi järgi, Enter valib ja liigub edasi
  await page.getByLabel("Konto 1").fill("4100");
  await page.keyboard.press("Enter");
  await page.getByLabel("Deebet 1").fill("123,45");
  await page.keyboard.press("Enter"); // järgmine rida
  await page.getByLabel("Konto 2").fill("1020");
  await page.keyboard.press("Enter");
  // Rida 2: tasakaalustav summa on juba kreeditis
  await expect(page.getByLabel("Kreedit 2")).toHaveValue("");
  await page.getByLabel("Kreedit 2").fill("123.45");
  await expect(page.getByRole("status")).toHaveText("Tasakaalus");
  await page.getByRole("button", { name: "Postita" }).click();
  await page.waitForURL(/finance\/journal\?entry=/);
  await expect(page.getByText(description).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^PR-\d+$/ })).toBeVisible();

  // Storno
  await page.getByRole("button", { name: "Storneeri" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Storneeri" }).click();
  await page.waitForURL(/finance\/journal\?entry=/);
  await expect(page.getByText("See on storno kandele")).toBeVisible();

  // Käibeandmik on tasakaalus
  await page.goto(`${base}/finance/trial-balance`);
  await expect(page.getByText("Deebet ja kreedit on tasakaalus.")).toBeVisible();

  // Pearaamat konto 4100 kohta
  await page.getByRole("link", { name: /4100/ }).first().click();
  await expect(page.getByRole("heading", { name: /4100/ })).toBeVisible();

  // CSV eksport
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^ledger_.*\.csv$/);
});
