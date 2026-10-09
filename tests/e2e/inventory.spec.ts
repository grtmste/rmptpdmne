import { expect, test } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 8: laod, laoliikumised, laoseis ja aruanded.
 * Eeldab demoandmeid (pnpm db:seed); testid on korduvkäivitatavad.
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
  page.on("dialog", (d) => d.accept());
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

test("laod ja laoseis klapivad pearaamatuga", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/inventory/warehouses`);
  await expect(page.getByText("Põhiladu").first()).toBeVisible();
  await expect(page.getByText("Aianduspood").first()).toBeVisible();
  await expect(page.getByLabel("Meetod")).toHaveValue("FIFO");

  await page.goto(`${base}/inventory/stock`);
  const table = page.getByTestId("stock-table");
  await expect(table.getByRole("row").filter({ hasText: "Roosipõõsas" })).toBeVisible();
  await expect(page.getByTestId("stock-check").getByText("Klapib")).toBeVisible();
});

test("sissetulek: uus liikumine, kinnitamine ja kanne", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/inventory/movements/new?type=RECEIPT`);
  await page.getByLabel("Vastaskonto").selectOption({ label: "2950 Eelmiste perioodide jaotamata kasum" });
  await page.getByLabel("Kirjeldus").fill(`Järeltarne ${Date.now()}`);
  await page.getByRole("combobox", { name: "Artikkel 1" }).fill("MULD");
  await page.keyboard.press("Enter");
  await page.getByLabel("Kogus 1").fill("10");
  await page.getByLabel("Ühiku omahind 1").fill("3.20");
  await expect(page.getByText("32,00")).toBeVisible();
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/inventory\/movements\?doc=/);
  await expect(page.getByRole("heading", { name: /^L-\d+$/ })).toBeVisible();
  await expect(page.getByText("Kinnitatud").first()).toBeVisible();
  await expect(page.getByText("Laoseisu väärtuse muutus")).toBeVisible();
});

test("laoseisust suuremat väljaminekut ei kinnitata", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/inventory/movements/new?type=ISSUE`);
  await page.getByRole("combobox", { name: "Artikkel 1" }).fill("ROOS");
  await page.keyboard.press("Enter");
  await page.getByLabel("Kogus 1").fill("100000");
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await expect(page.getByText(/ei jätku kaupa ROOS Roosipõõsas/)).toBeVisible();
});

test("inventuur täidab laoseisuga ja aruanded avanevad", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/inventory/movements/new?type=COUNT`);
  await page.getByRole("button", { name: "Täida laoseisuga" }).click();
  await expect(page.getByRole("columnheader", { name: "Arvestuslik" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Artikkel 1" })).not.toHaveValue("");

  await page.goto(`${base}/inventory/item-movement`);
  await expect(page.getByTestId("item-movement").getByText("Lõppseis")).toBeVisible();
  await page.goto(`${base}/inventory/turnover`);
  await expect(page.getByTestId("stock-turnover")).toBeVisible();
  await page.goto(`${base}/inventory/analysis`);
  await expect(page.getByTestId("stock-analysis").getByText("Roosipõõsas")).toBeVisible();
});
