import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTANT_STATE } from "./auth-state";

/**
 * Faas 5: laekumine arve eelvaatest ning pangaväljavõtte import viitenumbri järgi sobitamisega.
 * Eeldab demoandmeid (pnpm db:seed) – demo pangakonto IBAN EE717700771001735865.
 */
test.use({ storageState: ACCOUNTANT_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/c\//);
});

const companyBase = (url: string) => new URL(url).pathname.split("/").slice(0, 3).join("/");

/** Kinnitatud müügiarve 50 + KM 24% = 62,00; tagastab arve numbri ja viitenumbri. */
async function confirmedInvoice(page: Page, base: string) {
  await page.goto(`${base}/sales/invoices/new`);
  await page.getByRole("combobox", { name: "Klient" }).fill("Kohvik");
  await page.keyboard.press("Enter");
  await page.getByLabel("Kirjeldus 1").fill("Konsultatsioon");
  await page.getByLabel("Hind 1").fill("50");
  await expect(page.getByTestId("doc-total")).toHaveText("62,00");
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/sales\/invoices\?doc=/);
  const heading = page.locator("h2").filter({ hasText: /^\d+$/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())!;
  const reference = (await page.getByText("Viitenumber", { exact: true }).locator("xpath=following-sibling::span").textContent())!;
  return { number, reference, url: page.url() };
}

test("laekumine arve eelvaatest teeb arve tasutuks", async ({ page }) => {
  const base = companyBase(page.url());
  const invoice = await confirmedInvoice(page, base);
  await expect(page.getByText("Tasumata 62,00 EUR")).toBeVisible();

  await page.getByRole("link", { name: "Lisa laekumine" }).click();
  await page.waitForURL(/payments\/new\?salesInvoice=/);
  await expect(page.getByLabel(`Seo summa ${invoice.number}`)).toHaveValue("62.00");
  await expect(page.getByRole("status").filter({ hasText: "Summad klapivad" })).toBeVisible();
  await page.getByRole("button", { name: "Kinnita", exact: true }).click();
  await page.waitForURL(/payments\?doc=/);
  await expect(page.getByText("Makse kinnitatud ja kanne tehtud.")).toBeVisible();

  await page.goto(invoice.url);
  await expect(page.getByText("Tasutud täielikult")).toBeVisible();
});

test("pangaväljavõtte import sobitab laekumise viitenumbri järgi", async ({ page }) => {
  const base = companyBase(page.url());
  const invoice = await confirmedInvoice(page, base);
  const today = new Date().toISOString().slice(0, 10);
  const bankRef = `E2E${Date.now()}`;
  const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>${bankRef}</MsgId><CreDtTm>${today}T10:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>${bankRef}</Id>
   <FrToDt><FrDtTm>${today}T00:00:00</FrDtTm><ToDtTm>${today}T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>EE717700771001735865</IBAN></Id><Ccy>EUR</Ccy></Acct>
   <Ntry>
    <Amt Ccy="EUR">62.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>${today}</Dt></BookgDt>
    <NtryDtls><TxDtls>
     <Refs><AcctSvcrRef>${bankRef}</AcctSvcrRef></Refs>
     <RltdPties><Dbtr><Nm>Kohvik Roheline OÜ</Nm></Dbtr></RltdPties>
     <RmtInf><Ustrd>Makse</Ustrd><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${invoice.reference}</Ref></CdtrRefInf></Strd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

  await page.goto(`${base}/payments/statements`);
  await page.getByLabel("Vali väljavõtte fail").setInputFiles({ name: "valjavote.xml", mimeType: "application/xml", buffer: Buffer.from(camt) });
  await page.waitForURL(/payments\/statements\/.+/);
  await expect(page.getByText("Imporditud 1 tehingut, vahele jäeti 0.")).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: invoice.reference });
  await expect(row.getByText("viitenumber", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Kinnita", exact: true }).click();
  await expect(page.getByText("Makse loodud.")).toBeVisible();
  await expect(row.getByRole("link", { name: /^makse / })).toBeVisible();

  await page.goto(invoice.url);
  await expect(page.getByText("Tasutud täielikult")).toBeVisible();
});
