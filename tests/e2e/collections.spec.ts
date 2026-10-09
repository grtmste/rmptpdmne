import { expect, test } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 7: perioodilised arved, saldoteatised, viivised ja koondarve.
 * Eeldab demoandmeid (pnpm db:seed); testid on korduvkäivitatavad.
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
  page.on("dialog", (d) => d.accept());
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

test("perioodiline arve: loomine ja järgmise arve koostamine", async ({ page }) => {
  const base = companyBase(page.url());
  const name = `Kuutasu ${Date.now()}`;
  await page.goto(`${base}/sales/recurring/new`);
  await page.getByLabel("Nimetus").fill(name);
  await page.getByLabel("Kordus").selectOption("3");
  await page.getByRole("combobox", { name: "Klient" }).fill("Kohvik");
  await page.keyboard.press("Enter");
  await page.getByLabel("Kirjeldus 1").fill("Hooldus [periood]");
  await page.getByLabel("Hind 1").fill("100");
  await page.getByRole("button", { name: "Salvesta", exact: true }).click();
  await page.waitForURL(/sales\/recurring\?doc=/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Kord kvartalis").first()).toBeVisible();

  await page.getByRole("button", { name: "Koosta järgmine arve kohe" }).click();
  await page.waitForURL(/sales\/invoices\?doc=/);
  // Kvartaliarve kirjelduses on perioodi vahemik
  await expect(page.getByText(/Hooldus \d{2}\.\d{2}\.\d{4}–\d{2}\.\d{2}\.\d{4}/)).toBeVisible();
});

test("saldoteatised: PDF eelvaade ja saatmine logiga", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/sales/reminders?kind=STATEMENT`);
  const table = page.getByTestId("reminder-table");
  await expect(table).toBeVisible();
  const row = table.getByRole("row").filter({ hasText: "Kohvik Roheline OÜ" });
  await expect(row).toBeVisible();

  const href = await row.getByRole("link", { name: /PDF/ }).getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  // Ainult Kohvik valituks
  await page.getByLabel("Vali kõik").uncheck();
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Saada saldoteatised" }).click();
  await expect(page.getByText("Saadetud 1 kirja.")).toBeVisible();
  await expect(page.getByTestId("reminder-log").getByText("Kohvik Roheline OÜ").first()).toBeVisible();
});

test("viivised ja koondarve lehed", async ({ page }) => {
  const base = companyBase(page.url());
  await page.goto(`${base}/sales/interest`);
  const table = page.getByTestId("interest-table");
  if (await table.isVisible()) {
    await page.getByRole("button", { name: "Koosta viivisearved" }).click();
    await page.waitForURL(/sales\/invoices\?doc=/);
    await expect(page.getByText(/^Viivis arve/).first()).toBeVisible();
  } else {
    await expect(page.getByText("Viivist pole")).toBeVisible();
  }

  await page.goto(`${base}/sales/consolidated`);
  await expect(page.getByRole("heading", { name: "Koondarved" })).toBeVisible();
});
