import { expect, test } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 4: ostuarve üleslaadimisest kinnitamiseni, EL teenuse pöördmaksustamine ja kuluaruanne.
 * Eeldab demoandmeid (pnpm db:seed).
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

// Minimaalne kehtiv PDF
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

test("üleslaaditud ostuarve täitmine ja kinnitamine", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/purchases/inbox`);
  await page.getByLabel("Vali failid").setInputFiles({ name: "arve-123.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("Fail üles laaditud.")).toBeVisible();
  await page.getByRole("list", { name: "Kinnitamata ostuarved" }).getByRole("link").first().click();
  await page.waitForURL(/purchases\/invoices\/.+\/edit$/);
  await expect(page.getByText("arve-123.pdf")).toBeVisible();

  await page.getByRole("combobox", { name: "Tarnija" }).fill("Sidefirma");
  await page.keyboard.press("Enter");
  const number = `E2E-${Date.now()}`;
  await page.getByLabel("Tarnija arve nr").fill(number);
  await page.getByLabel("Kirjeldus 1").fill("Pilveteenus");
  await page.getByLabel("Hind 1").fill("100");
  // Tarnija vaikimisi kulukonto ja KM 24%
  await expect(page.getByTestId("doc-total")).toHaveText("124,00");
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/purchases\/invoices\?doc=/);
  await expect(page.locator("h2").filter({ hasText: /^OA-\d+$/ })).toBeVisible();
  await expect(page.getByText(`arve ${number}`)).toBeVisible();
});

test("EL teenus pöördmaksustamisega ja kuluaruanne", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/purchases/invoices/new`);
  await page.getByRole("combobox", { name: "Tarnija" }).fill("Sidefirma");
  await page.keyboard.press("Enter");
  await page.getByLabel("Tarnija arve nr").fill(`EU-${Date.now()}`);
  await page.getByLabel("Kirjeldus 1").fill("Reklaam välismaisel platvormil");
  await page.getByLabel("Hind 1").fill("200");
  await page.getByLabel("Käibemaks 1").selectOption({ label: "Teenus EL maksukohustuslasele" });
  await expect(page.getByTestId("doc-total")).toHaveText("200,00");
  await expect(page.getByText("Pöördmaksustatav KM (arvestad ise)")).toBeVisible();
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/purchases\/invoices\?doc=/);

  await page.goto(`${base}/purchases/expenses/new`);
  await page.getByLabel("Aruandev isik").selectOption({ label: "Mari Maasikas" });
  await page.getByLabel("Kirjeldus 1").fill("Taksosõit");
  await page.getByLabel("Summa KM-ga 1").fill("12,40");
  await expect(page.getByTestId("doc-total")).toHaveText("12,40");
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/purchases\/expenses\?doc=/);
  await expect(page.locator("h2").filter({ hasText: /^KA-\d+$/ })).toBeVisible();
});
