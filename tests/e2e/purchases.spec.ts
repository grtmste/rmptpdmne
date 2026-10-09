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
  await expect(page.getByText("arve-123.pdf").first()).toBeVisible();

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

/** Lihtne tekstikihiga PDF (Helvetica, ASCII). */
function textPdf(lines: string[]) {
  const ops = lines.map((l, i) => `${i === 0 ? "" : "0 -16 Td "}(${l.replace(/[()\\]/g, "")}) Tj`).join("\n");
  const stream = `BT /F1 11 Tf 50 800 Td\n${ops}\nET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj${o}endobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

test("uus ostuarve: fail kohe juurde, andmed tuvastatakse ja manus salvestub", async ({ page }) => {
  const base = companyBase(page.url());
  const number = `SF-${Date.now()}`;
  await page.goto(`${base}/purchases/invoices/new`);
  await page.getByLabel("Lisa fail").setInputFiles({
    name: "sidefirma.pdf",
    mimeType: "application/pdf",
    buffer: textPdf([
      "Sidefirma AS",
      "Registry code: 10234567",
      `Invoice No: ${number}`,
      "Invoice date: 01.10.2026",
      "Due date: 15.10.2026",
      "Subtotal 100,00",
      "VAT 24% 24,00",
      "Total due 124,00 EUR",
    ]),
  });
  await expect(page.getByTestId("extract-banner")).toContainText("Tuvastatud");
  await expect(page.getByLabel("Tarnija arve nr")).toHaveValue(number);
  await expect(page.getByRole("combobox", { name: "Tarnija" })).toHaveValue("Sidefirma AS");
  await expect(page.getByTestId("doc-total")).toHaveText("124,00");
  // Eelvaade on kohe näha
  await expect(page.getByRole("img", { name: "Eelvaade: sidefirma.pdf" })).toBeVisible();

  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/purchases\/invoices\?doc=/);
  await expect(page.getByText(`arve ${number}`).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "sidefirma.pdf" })).toBeVisible();
});
