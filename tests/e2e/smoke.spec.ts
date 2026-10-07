import { expect, test } from "@playwright/test";

/**
 * Põhivoog: registreerimine → ettevõtte loomine → käsupalett → teise ettevõtte loomine ja vahetamine.
 * Eeldab migreeritud andmebaasi.
 */
test("registreerimine, ettevõtte loomine ja vahetamine", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.ee`;
  await page.goto("/register");
  await page.getByLabel("Nimi", { exact: true }).fill("Testi Kasutaja");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Parool", { exact: true }).fill("turvaline-parool-1");
  await page.getByRole("button", { name: "Loo konto" }).click();

  await expect(page).toHaveURL(/\/companies\/new$/);
  await page.getByLabel("Ettevõtte nimi", { exact: true }).fill("Esimene OÜ");
  await page.getByLabel("Registrikood").fill("12345678");
  await page.getByRole("button", { name: "Loo ettevõte" }).click();

  await expect(page).toHaveURL(/\/c\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Tere, Testi!" })).toBeVisible();

  // Käsupalett
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Kuhu soovid minna või mida teha?").fill("ettevõtte andmed");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/company$/);
  await expect(page.getByLabel("Ettevõtte nimi", { exact: true })).toHaveValue("Esimene OÜ");

  // Teine ettevõte ja vahetamine
  await page.goto("/companies/new");
  await page.getByLabel("Ettevõtte nimi", { exact: true }).fill("Teine AS");
  await page.getByRole("button", { name: "Loo ettevõte" }).click();
  await expect(page.getByText("Teine AS").first()).toBeVisible();
  await page.getByRole("button", { name: "Vaheta ettevõtet" }).click();
  await page.getByPlaceholder("Otsi ettevõtet nime või koodi järgi…").fill("Esimene");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Vaheta ettevõtet" })).toContainText("Esimene OÜ");
});

test("võõra ettevõtte aadress annab 404", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-post").fill("vaataja@demo.ee");
  await page.getByLabel("Parool", { exact: true }).fill("demo-parool-123");
  await page.getByRole("button", { name: "Logi sisse" }).click();
  await expect(page).toHaveURL(/\/c\//);
  const res = await page.goto("/c/olematu-ettevote");
  expect(res?.status()).toBe(404);
});
