import { describe, expect, it } from "vitest";
import { allocationDifference, buildPaymentPosting, cashEffect, documentShareBase } from "@/lib/payments/posting";
import { parseBankCsv, parseCamt053, parseStatement } from "@/lib/payments/statement";
import { buildPain001 } from "@/lib/payments/pain001";
import { dec } from "@/lib/money";

describe("makse sidumised", () => {
  it("laekumine kahe arve ja ettemaksuga", () => {
    const allocations = [
      { type: "SALES_INVOICE" as const, amount: "100" },
      { type: "SALES_INVOICE" as const, amount: "50" },
      { type: "PREPAYMENT" as const, amount: "10" },
    ];
    expect(allocationDifference("IN", "160", allocations).toFixed(2)).toBe("0.00");
    expect(allocationDifference("IN", "150", allocations).toFixed(2)).toBe("-10.00");
  });

  it("väljamakse tarnijale ja pangatasu kulusse", () => {
    expect(
      allocationDifference("OUT", "125.50", [
        { type: "PURCHASE_INVOICE", amount: "124" },
        { type: "ACCOUNT", amount: "1.50" },
      ]).toFixed(2),
    ).toBe("0.00");
  });

  it("tasaarveldus: müügiarve ja ostuarve, raha ei liigu", () => {
    expect(cashEffect("NETTING", "SALES_INVOICE", "80").toFixed(2)).toBe("80.00");
    expect(
      allocationDifference("NETTING", "0", [
        { type: "SALES_INVOICE", amount: "80" },
        { type: "PURCHASE_INVOICE", amount: "80" },
      ]).toFixed(2),
    ).toBe("0.00");
  });

  it("kreeditarve tagastus kliendile (väljamakse, negatiivne sidumine)", () => {
    expect(allocationDifference("OUT", "24", [{ type: "SALES_INVOICE", amount: "-24" }]).toFixed(2)).toBe("0.00");
  });

  it("valuutaarve osa eurodes: osaline proportsionaalselt, lõpetav jääk", () => {
    expect(documentShareBase({ amount: "500", total: "1000", totalBase: "800", paidBefore: "0" }).toFixed(2)).toBe("400.00");
    expect(documentShareBase({ amount: "500", total: "1000", totalBase: "800", paidBefore: "500", paidBaseBefore: "399.99" }).toFixed(2)).toBe("400.01");
  });
});

describe("makse kanne", () => {
  it("laekumine: D pank, K nõuded", () => {
    const rows = buildPaymentPosting({ cashAccountId: "1020", cashBase: "124", parts: [{ accountId: "1200", credit: dec("124") }], fxAccountId: "3810" });
    expect(rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2)])).toEqual([
      ["1020", "124.00", "0.00"],
      ["1200", "0.00", "124.00"],
    ]);
  });

  it("väljamakse: D võlad, K pank", () => {
    const rows = buildPaymentPosting({ cashAccountId: "1020", cashBase: "-50", parts: [{ accountId: "2110", credit: dec("-50") }], fxAccountId: "3810" });
    expect(rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2)])).toEqual([
      ["1020", "0.00", "50.00"],
      ["2110", "50.00", "0.00"],
    ]);
  });

  it("kursivahe läheb kursivahe kontole", () => {
    // USD arve 800 € eest, laekumine 1000 USD kursiga 1,20 = 833,33 €
    const rows = buildPaymentPosting({ cashAccountId: "1020", cashBase: "833.33", parts: [{ accountId: "1200", credit: dec("800") }], fxAccountId: "3810" });
    expect(rows.map((r) => [r.accountId, r.debit.toFixed(2), r.credit.toFixed(2)])).toEqual([
      ["1020", "833.33", "0.00"],
      ["1200", "0.00", "800.00"],
      ["3810", "0.00", "33.33"],
    ]);
  });
});

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>1</MsgId><CreDtTm>2026-10-08T10:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>ST-2026-10</Id>
   <FrToDt><FrDtTm>2026-10-01T00:00:00</FrDtTm><ToDtTm>2026-10-07T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>EE382200221020145685</IBAN></Id><Ccy>EUR</Ccy></Acct>
   <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-01</Dt></Dt></Bal>
   <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1073.80</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-07</Dt></Dt></Bal>
   <Ntry>
    <Amt Ccy="EUR">124.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2026-10-02</Dt></BookgDt>
    <NtryDtls><TxDtls>
     <Refs><AcctSvcrRef>2026100200001</AcctSvcrRef></Refs>
     <RltdPties><Dbtr><Nm>Kohvik Roheline OÜ</Nm></Dbtr><DbtrAcct><Id><IBAN>EE471000001020145685</IBAN></Id></DbtrAcct></RltdPties>
     <RmtInf><Ustrd>Arve 1002</Ustrd><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>10029</Ref></CdtrRefInf></Strd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="EUR">49.48</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2026-10-05</Dt></BookgDt>
    <NtryDtls><TxDtls>
     <Refs><AcctSvcrRef>2026100500002</AcctSvcrRef></Refs>
     <RltdPties><Cdtr><Nm>Sidefirma AS</Nm></Cdtr><CdtrAcct><Id><IBAN>EE471000001020145685</IBAN></Id></CdtrAcct></RltdPties>
     <RmtInf><Ustrd>S-88123</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
   </Ntry>
   <Ntry>
    <Amt Ccy="EUR">0.72</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2026-10-06</Dt></BookgDt>
    <AddtlNtryInf>Teenustasu</AddtlNtryInf>
   </Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

describe("pangaväljavõte", () => {
  it("camt.053", () => {
    const s = parseCamt053(CAMT);
    expect(s.iban).toBe("EE382200221020145685");
    expect(s.openingBalance).toBe("1000.00");
    expect(s.closingBalance).toBe("1073.80");
    expect(s.entries).toEqual([
      {
        date: "2026-10-02",
        amount: "124.00",
        currency: "EUR",
        partyName: "Kohvik Roheline OÜ",
        partyIban: "EE471000001020145685",
        referenceNumber: "10029",
        description: "Arve 1002",
        bankReference: "2026100200001",
      },
      expect.objectContaining({ amount: "-49.48", partyName: "Sidefirma AS", description: "S-88123" }),
      expect.objectContaining({ amount: "-0.72", description: "Teenustasu", partyName: null }),
    ]);
    expect(parseStatement(CAMT).format).toBe("CAMT053");
  });

  it("Swedbanki CSV (reatüübid, D/K)", () => {
    const csv = [
      '"Kliendi konto";"Reatüüp";"Kuupäev";"Saaja/Maksja";"Selgitus";"Summa";"Valuuta";"Deebet/Kreedit";"Arhiveerimistunnus";"Tehingu tüüp";"Viitenumber";"Dokumendi number"',
      '"EE382200221020145685";"10";"01.10.2026";"";"Algsaldo";"1000,00";"EUR";"K";"";"AS";"";""',
      '"EE382200221020145685";"20";"02.10.2026";"Kohvik Roheline OÜ";"Arve 1002";"124,00";"EUR";"K";"2026100200001";"MK";"10029";""',
      '"EE382200221020145685";"20";"05.10.2026";"Sidefirma AS";"S-88123";"49,48";"EUR";"D";"2026100500002";"MK";"";"5"',
    ].join("\r\n");
    const s = parseBankCsv(csv);
    expect(s.iban).toBe("EE382200221020145685");
    expect(s.entries.map((e) => [e.date, e.amount, e.partyName, e.referenceNumber])).toEqual([
      ["2026-10-02", "124.00", "Kohvik Roheline OÜ", "10029"],
      ["2026-10-05", "-49.48", "Sidefirma AS", null],
    ]);
  });

  it("LHV CSV (komaga, märgiga summa)", () => {
    const csv = [
      '"Customer account no","Document no","Date","Beneficiary\'s account","Beneficiary\'s name","Beneficiary bank code","Empty","Debit/Credit (D/C)","Amount","Reference number","Archiving code","Description","Fee","Currency"',
      '"EE717700771001234567","1","2026-10-03","EE471000001020145685","Liis Lepp","","","C","157.50","10032","ABC1","Arve 1003","0.00","EUR"',
    ].join("\n");
    const s = parseBankCsv(csv);
    expect(s.entries[0]).toMatchObject({ date: "2026-10-03", amount: "157.50", referenceNumber: "10032", description: "Arve 1003", bankReference: "ABC1" });
  });

  it("vigane fail", () => {
    expect(() => parseCamt053("<foo/>")).toThrow();
    expect(() => parseBankCsv("a;b\n1;2")).toThrow();
  });
});

describe("pain.001", () => {
  it("koostab SEPA maksekorralduse koos viitenumbriga", () => {
    const xml = buildPain001({
      messageId: "LS-20261008-1",
      createdAt: new Date("2026-10-08T12:00:00Z"),
      executionDate: "2026-10-09",
      debtor: { name: "Lilleaed OÜ", iban: "EE382200221020145685", regCode: "16000001" },
      payments: [
        { endToEndId: "OA-1", amount: "456.32", creditorName: "Taimla & Co <OÜ>", creditorIban: "EE471000001020145685", referenceNumber: "12345", description: "Arve TP-2291" },
        { endToEndId: "OA-2", amount: "49.48", creditorName: "Sidefirma AS", creditorIban: "EE471000001020145685", description: "S-88123" },
      ],
    });
    expect(xml).toContain("<NbOfTxs>2</NbOfTxs>");
    expect(xml).toContain("<CtrlSum>505.80</CtrlSum>");
    expect(xml).toContain("<Nm>Taimla &amp; Co &lt;OÜ&gt;</Nm>");
    expect(xml).toContain("<Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>12345</Ref>");
    expect(xml).toContain("<ReqdExctnDt>2026-10-09</ReqdExctnDt>");
  });
});
