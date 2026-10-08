/**
 * SEPA maksekorralduste fail ISO 20022 pain.001.001.03 (Eesti pangad: Swedbank, SEB, LHV,
 * Luminor, Coop). Viitenumber struktureeritud viitena (SCOR), selgitus vabatekstina.
 */

export type Pain001Payment = {
  endToEndId: string;
  amount: string; // 2 komakohta
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  referenceNumber?: string | null;
  description?: string | null;
};

export type Pain001Input = {
  messageId: string;
  createdAt: Date;
  executionDate: string; // YYYY-MM-DD
  debtor: { name: string; iban: string; bic?: string | null; regCode?: string | null };
  payments: Pain001Payment[];
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Pangad lubavad nimes ja selgituses piiratud pikkust. */
const clip = (s: string, n: number) => esc(s.replace(/\s+/g, " ").trim().slice(0, n));

export function buildPain001(input: Pain001Input): string {
  const total = input.payments.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
  const ctrlSum = (total / 100).toFixed(2);
  const created = input.createdAt.toISOString().slice(0, 19);
  const txs = input.payments
    .map(
      (p) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${clip(p.endToEndId, 35)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${p.amount}</InstdAmt></Amt>${
          p.creditorBic ? `\n        <CdtrAgt><FinInstnId><BIC>${clip(p.creditorBic, 11)}</BIC></FinInstnId></CdtrAgt>` : ""
        }
        <Cdtr><Nm>${clip(p.creditorName, 70)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${clip(p.creditorIban, 34)}</IBAN></Id></CdtrAcct>${
          p.description || p.referenceNumber
            ? `\n        <RmtInf>${p.description ? `<Ustrd>${clip(p.description, 140)}</Ustrd>` : ""}${
                p.referenceNumber
                  ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${clip(p.referenceNumber, 35)}</Ref></CdtrRefInf></Strd>`
                  : ""
              }</RmtInf>`
            : ""
        }
      </CdtTrfTxInf>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${clip(input.messageId, 35)}</MsgId>
      <CreDtTm>${created}</CreDtTm>
      <NbOfTxs>${input.payments.length}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty><Nm>${clip(input.debtor.name, 70)}</Nm>${
        input.debtor.regCode ? `<Id><OrgId><Othr><Id>${clip(input.debtor.regCode, 35)}</Id></Othr></OrgId></Id>` : ""
      }</InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${clip(input.messageId, 35)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>false</BtchBookg>
      <NbOfTxs>${input.payments.length}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${input.executionDate}</ReqdExctnDt>
      <Dbtr><Nm>${clip(input.debtor.name, 70)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${clip(input.debtor.iban, 34)}</IBAN></Id><Ccy>EUR</Ccy></DbtrAcct>
      <DbtrAgt><FinInstnId>${input.debtor.bic ? `<BIC>${clip(input.debtor.bic, 11)}</BIC>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${txs}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
