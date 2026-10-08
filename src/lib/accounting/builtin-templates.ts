/**
 * Sisseehitatud kandemallid levinud ja erijuhtude kannete jaoks. Kontod on vaikekontoplaani
 * koodid; kui ettevõtte kontoplaanis koodi pole, jääb rida kontota ja kasutaja valib selle ise.
 * Nimed ja selgitused on tõlgetes (`journal.builtin.<id>`).
 */
export type BuiltinTemplate = {
  id: string;
  lines: Array<{ account: string; side: "D" | "C" }>;
};

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { id: "shareCapital", lines: [{ account: "1020", side: "D" }, { account: "2900", side: "C" }] },
  { id: "loanReceived", lines: [{ account: "1020", side: "D" }, { account: "2700", side: "C" }] },
  // Kapitalirent: maksegraafiku järgi järgmise 12 kuu osa pikaajalisest lühiajaliseks
  { id: "leaseReclass", lines: [{ account: "2710", side: "D" }, { account: "2020", side: "C" }] },
  // Finantsinvesteeringud õiglases väärtuses (RTJ 3)
  { id: "investmentUp", lines: [{ account: "1100", side: "D" }, { account: "3830", side: "C" }] },
  { id: "investmentDown", lines: [{ account: "3830", side: "D" }, { account: "1100", side: "C" }] },
  // Sisendkäibemaksu korrigeerimine (proportsionaalne arvestus, sõiduauto) – KMD rida 10
  { id: "inputVatCorrection", lines: [{ account: "4190", side: "D" }, { account: "2315", side: "C" }] },
  { id: "accruedExpense", lines: [{ account: "4190", side: "D" }, { account: "2430", side: "C" }] },
  { id: "prepaidExpense", lines: [{ account: "4100", side: "D" }, { account: "1290", side: "C" }] },
  { id: "holidayAccrual", lines: [{ account: "4200", side: "D" }, { account: "2230", side: "C" }] },
  { id: "badDebt", lines: [{ account: "4400", side: "D" }, { account: "1200", side: "C" }] },
  { id: "statutoryReserve", lines: [{ account: "2950", side: "D" }, { account: "2920", side: "C" }] },
  // Dividend ja selle tulumaks (tulumaks kajastatakse kuluna dividendi väljakuulutamise perioodis)
  {
    id: "dividend",
    lines: [
      { account: "2950", side: "D" },
      { account: "2420", side: "C" },
      { account: "4900", side: "D" },
      { account: "2330", side: "C" },
    ],
  },
];
