import { expect, test } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 6: finantsaruanded, KMD (XML ja sulgemine), võlgnevused ja töölaua kohandamine.
 * Eeldab demoandmeid (pnpm db:seed).
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

test("bilanss, kasumiaruande skeem 2 ja rahavood", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/finance/balance-sheet`);
  await expect(page.locator('[data-line="BS_TOTAL_ASSETS"]')).toBeVisible();
  await expect(page.getByText(/Bilanss ei ole tasakaalus/)).toHaveCount(0);

  await page.goto(`${base}/finance/income-statement`);
  await page.getByLabel("Skeem", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Näita" }).click();
  await page.waitForURL(/scheme=2/);
  await expect(page.locator('[data-line="S2_GROSS_PROFIT"]')).toBeVisible();
  await expect(page.locator('[data-line="IS_NET_PROFIT"]')).toBeVisible();

  await page.goto(`${base}/finance/cash-flow`);
  await expect(page.locator('[data-line="CF_NET"]')).toBeVisible();
  await expect(page.getByText(/kokkuvõte võrdub raha saldo muutusega/)).toBeVisible();
});

test("KMD: XML ja perioodi sulgemine", async ({ page }) => {
  const base = companyBase(page.url());
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/finance/vat`);
  await expect(page.getByTestId("kmd-table")).toBeVisible();
  await expect(page.locator('[data-line="12"]')).toBeVisible();

  const href = await page.getByRole("link", { name: "Lae alla XML (e-MTA)" }).getAttribute("href");
  const xml = await page.request.get(href!);
  expect(xml.status()).toBe(200);
  const body = await xml.text();
  expect(body).toContain("<vatDeclaration>");
  expect(body).toContain("<taxPayerRegCode>");

  await page.getByRole("button", { name: "Sulge periood" }).click();
  await expect(page.getByText("Sulgemiskanne tehtud.")).toBeVisible();
  await expect(page.getByText("Periood on suletud kandega")).toBeVisible();
  await page.getByRole("button", { name: "Tühista sulgemine" }).click();
  await expect(page.getByText("Sulgemine tühistatud.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sulge periood" })).toBeVisible();
});

test("kliendivõlgnevused ja käibeandmik", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/sales/reports/receivables`);
  await expect(page.getByTestId("aging-table")).toBeVisible();
  await expect(page.getByTestId("aging-table").getByText("Kohvik Roheline OÜ")).toBeVisible();

  await page.getByLabel("Vaade").selectOption("turnover");
  await page.getByRole("button", { name: "Näita" }).click();
  await page.waitForURL(/mode=turnover/);
  await expect(page.getByTestId("turnover-table")).toBeVisible();

  await page.goto(`${base}/sales/reports/sales?group=item`);
  await expect(page.getByTestId("doc-report")).toBeVisible();
  const csv = await page.request.get(`${base}/report-export/sales?group=customer`);
  expect(csv.status()).toBe(200);
});

test("töölaua vidina peitmine ja taastamine", async ({ page }) => {
  await expect(page.getByTestId("receivables-total")).toBeVisible();
  await page.getByRole("button", { name: "Kohanda" }).click();
  await page.getByRole("button", { name: "Peida: Kiirklahvid" }).click();
  await page.getByRole("button", { name: "Salvesta paigutus" }).click();
  await expect(page.getByText("Töölaua paigutus salvestatud.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Kiirklahvid" })).toHaveCount(0);

  await page.getByRole("button", { name: "Kohanda" }).click();
  await page.getByRole("button", { name: "Taasta vaikimisi" }).click();
  await page.getByRole("button", { name: "Salvesta paigutus" }).click();
  await expect(page.getByText("Töölaua paigutus salvestatud.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Kiirklahvid" })).toBeVisible();
});
