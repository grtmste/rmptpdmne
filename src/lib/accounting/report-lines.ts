/**
 * Bilansi ja kasumiaruande read (Raamatupidamise seaduse lisad 1 ja 2, äriühingu lühendatud
 * vorm). Konto seotakse reaga GlAccount.reportLine kaudu; aruanded (faas 6) summeerivad
 * kontod ridade kaupa.
 *
 * Koodid on stabiilsed identifikaatorid – nimetusi võib muuta, koode mitte.
 */

export type ReportLine = {
  code: string;
  /** i18n võti nimeruumis `reportLines` */
  key: string;
  statement: "BALANCE" | "INCOME";
  /** Bilansi pool või kasumiaruande märk */
  side: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
};

const b = (code: string, side: ReportLine["side"]): ReportLine => ({ code, key: code, statement: "BALANCE", side });
const i = (code: string, side: ReportLine["side"]): ReportLine => ({ code, key: code, statement: "INCOME", side });

export const BALANCE_LINES: ReportLine[] = [
  // Käibevarad
  b("BS_CASH", "ASSET"),
  b("BS_ST_INVESTMENTS", "ASSET"),
  b("BS_ST_RECEIVABLES", "ASSET"),
  b("BS_INVENTORIES", "ASSET"),
  b("BS_ST_BIOLOGICAL", "ASSET"),
  b("BS_HELD_FOR_SALE", "ASSET"),
  // Põhivarad
  b("BS_LT_INVESTMENTS", "ASSET"),
  b("BS_SUBSIDIARIES", "ASSET"),
  b("BS_LT_RECEIVABLES", "ASSET"),
  b("BS_INVESTMENT_PROPERTY", "ASSET"),
  b("BS_PPE", "ASSET"),
  b("BS_LT_BIOLOGICAL", "ASSET"),
  b("BS_INTANGIBLES", "ASSET"),
  // Lühiajalised kohustised
  b("BS_ST_LOANS", "LIABILITY"),
  b("BS_ST_PAYABLES", "LIABILITY"),
  b("BS_ST_PROVISIONS", "LIABILITY"),
  b("BS_ST_GRANTS", "LIABILITY"),
  // Pikaajalised kohustised
  b("BS_LT_LOANS", "LIABILITY"),
  b("BS_LT_PAYABLES", "LIABILITY"),
  b("BS_LT_PROVISIONS", "LIABILITY"),
  b("BS_LT_GRANTS", "LIABILITY"),
  // Omakapital
  b("BS_SHARE_CAPITAL", "EQUITY"),
  b("BS_UNREGISTERED_CAPITAL", "EQUITY"),
  b("BS_UNPAID_CAPITAL", "EQUITY"),
  b("BS_SHARE_PREMIUM", "EQUITY"),
  b("BS_TREASURY_SHARES", "EQUITY"),
  b("BS_STATUTORY_RESERVE", "EQUITY"),
  b("BS_OTHER_RESERVES", "EQUITY"),
  b("BS_RETAINED_EARNINGS", "EQUITY"),
  b("BS_CURRENT_PROFIT", "EQUITY"),
];

/** Kasumiaruande skeem 1 (kulude liigi järgi). */
export const INCOME_LINES: ReportLine[] = [
  i("IS_REVENUE", "INCOME"),
  i("IS_OTHER_INCOME", "INCOME"),
  i("IS_INVENTORY_CHANGE", "INCOME"),
  i("IS_CAPITALISED_COSTS", "INCOME"),
  i("IS_MATERIALS", "EXPENSE"),
  i("IS_OTHER_OPEX", "EXPENSE"),
  i("IS_PERSONNEL", "EXPENSE"),
  i("IS_DEPRECIATION", "EXPENSE"),
  i("IS_CURRENT_ASSET_WRITEDOWN", "EXPENSE"),
  i("IS_OTHER_EXPENSES", "EXPENSE"),
  i("IS_SUBSIDIARIES", "INCOME"),
  i("IS_ASSOCIATES", "INCOME"),
  i("IS_BIOLOGICAL", "INCOME"),
  i("IS_FIN_INVESTMENTS", "INCOME"),
  i("IS_INTEREST_INCOME", "INCOME"),
  i("IS_INTEREST_EXPENSE", "EXPENSE"),
  i("IS_OTHER_FINANCE", "INCOME"),
  i("IS_INCOME_TAX", "EXPENSE"),
];

export const REPORT_LINES: ReportLine[] = [...BALANCE_LINES, ...INCOME_LINES];

const byCode = new Map(REPORT_LINES.map((l) => [l.code, l]));

export function findReportLine(code: string | null | undefined): ReportLine | undefined {
  return code ? byCode.get(code) : undefined;
}

/** Konto tüübile sobivad read (bilansikontole bilansi read, tulu/kulu kontole kasumiaruande read). */
export function reportLinesForType(type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE"): ReportLine[] {
  if (type === "INCOME" || type === "EXPENSE") return INCOME_LINES;
  return BALANCE_LINES.filter((l) => l.side === type);
}
