import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 9: põhivara register, kulum, muutused ja aruanded.
 * Eeldab demoandmeid (pnpm db:seed); testid on korduvkäivitatavad.
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
  page.on("dialog", (d) => d.accept());
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

async function createAsset(page: Page, base: string, name: string) {
  await page.goto(`${base}/assets/new`);
  await page.getByLabel("Kood").fill(`T${Date.now()}`.slice(0, 20));
  await page.getByLabel("Nimetus").fill(name);
  await page.getByLabel("Grupp").selectOption({ label: "Inventar ja arvutid" });
  await page.getByLabel("Soetusmaksumus").fill("1200");
  await page.getByLabel("Kasulik eluiga (kuud)").fill("36");
  await expect(page.getByText("33,33").first()).toBeVisible();
  await page.getByRole("button", { name: "Salvesta", exact: true }).click();
  await page.waitForURL(/assets\?doc=/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("register ja demovara ajalugu", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/assets`);
  await page.getByRole("link", { name: /Kaubik Ford Transit/ }).click();
  await expect(page.getByRole("heading", { name: "Kaubik Ford Transit" })).toBeVisible();
  await expect(page.getByTestId("asset-history").getByText("Kulum").first()).toBeVisible();
  await expect(page.getByText("Kulumiplaan")).toBeVisible();
});

test("uus vara ja mahakandmine", async ({ page }) => {
  const base = companyBase(page.url());
  const name = `Kohvimasin ${Date.now()}`;
  await createAsset(page, base, name);
  await expect(page.getByText("Kulumiplaan")).toBeVisible();
  await page.getByRole("button", { name: "Kanna maha" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Jääkväärtuse konto")).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Kanna maha" }).click();
  await expect(page.getByText("Vara kanti maha.")).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Maha kantud" })).toBeVisible();
});

test("kulumi arvestus ja tühistamine", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/assets/depreciation`);
  await expect(page.getByTestId("depreciation-runs")).toBeVisible();
  const preview = page.getByTestId("depreciation-preview");
  if (await preview.isVisible()) {
    await expect(preview.getByText("Kaubik Ford Transit")).toBeVisible();
    await page.getByRole("button", { name: "Arvesta kulum" }).click();
    await expect(page.getByText(/Kulum arvestatud \d+ varale/)).toBeVisible();
    await expect(page.getByText(/Selle kuu kulum on arvestatud/)).toBeVisible();
    // Tühistame, et test oleks korratav
    await page.getByTestId("depreciation-runs").getByRole("button", { name: "Tühista" }).click();
    await expect(page.getByText("Kulum tühistatud.")).toBeVisible();
  }
});

test("põhivara aruanded", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/assets/reports/list`);
  await expect(page.getByTestId("asset-list").getByText("Kaubik Ford Transit")).toBeVisible();
  await page.goto(`${base}/assets/reports/depreciation`);
  await expect(page.getByTestId("depreciation-report").getByText("Transpordivahendid")).toBeVisible();
  await page.goto(`${base}/assets/reports/summary`);
  await expect(page.getByTestId("asset-summary").getByText("Arvestatud kulum")).toBeVisible();
});
