import { expect, test } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 3: müügiarve klaviatuuriga, kinnitamine, PDF, saatmine ja kreeditarve; pakkumisest arve.
 * Eeldab demoandmeid (pnpm db:seed).
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

test("müügiarve: koostamine, kinnitamine, PDF, saatmine ja kreeditarve", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/sales/invoices/new`);

  await page.getByRole("combobox", { name: "Klient" }).fill("Kohvik");
  await page.keyboard.press("Enter");
  // Rida 1: artikkel koodi järgi täidab kirjelduse, hinna ja käibemaksu
  await page.getByLabel("Artikkel 1").fill("HOOL");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Kirjeldus 1")).toHaveValue("Aiahooldus");
  await page.getByLabel("Kogus 1").fill("2");
  await page.keyboard.press("Enter"); // hinnale
  await page.keyboard.press("Enter"); // uus rida
  await page.getByLabel("Kirjeldus 2").fill("Väetis");
  await page.getByLabel("Hind 2").fill("10");
  // 2 × 35 + 10 = 80; KM 24% = 19,20
  await expect(page.getByTestId("doc-total")).toHaveText("99,20");

  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/sales\/invoices\?doc=/);
  const preview = page.locator("h2").filter({ hasText: /^\d+$/ });
  await expect(preview).toBeVisible();
  const number = (await preview.textContent())!;

  // PDF
  const pdfHref = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  // Saatmine (arenduses kiri logisse)
  await page.getByRole("button", { name: "Saada" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Saaja")).toHaveValue("raamatupidamine@roheline.example");
  await expect(dialog.getByLabel("Teema")).toHaveValue(new RegExp(`^Arve ${number}`));
  await dialog.getByRole("button", { name: "Saada" }).click();
  await expect(page.getByText(/^Saadetud: raamatupidamine@roheline\.example/)).toBeVisible();

  // Kreeditarve
  await page.getByRole("button", { name: "Veel toiminguid" }).click();
  await page.getByRole("menuitem", { name: "Koosta kreeditarve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Loo mustand" }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByText(`See on kreeditarve arvele ${number}`)).toBeVisible();
  await expect(page.getByTestId("doc-total")).toHaveText("-99,20");
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/sales\/invoices\?doc=/);
  await expect(page.locator("h2").filter({ hasText: /^K-\d+$/ })).toBeVisible();
});

test("pakkumisest arve mustand", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/sales/quotes/new`);
  await page.getByRole("combobox", { name: "Klient" }).fill("Tartu");
  await page.keyboard.press("Enter");
  await page.getByLabel("Kirjeldus 1").fill("Talvine hekihooldus");
  await page.getByLabel("Kogus 1").fill("3");
  await page.getByLabel("Hind 1").fill("40");
  await page.getByRole("button", { name: "Salvesta" }).click();
  await page.waitForURL(/sales\/quotes\?doc=/);
  await page.getByRole("button", { name: "Tee arve" }).click();
  await page.waitForURL(/sales\/invoices\/.+\/edit$/);
  await expect(page.getByLabel("Kirjeldus 1")).toHaveValue("Talvine hekihooldus");
  await expect(page.getByTestId("doc-total")).toHaveText("148,80");
});
