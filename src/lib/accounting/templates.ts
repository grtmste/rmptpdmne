/**
 * Uue ettevõtte vaikimisi seadistus: Eesti äriühingu kontoplaan (kasumiaruande skeem 1),
 * käibemaksud kehtivusperioodidega, dimensioonid ja numbriseeriad.
 *
 * Kõik on hiljem ettevõtte seadistustes muudetav. Mall on meie oma koostatud, lähtudes
 * Raamatupidamise seaduse aruannete vormidest ja Eestis levinud koodiloogikast
 * (1 varad, 2 kohustised ja omakapital, 3 tulud, 4 kulud).
 */

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
type AccountRole =
  | "RECEIVABLES"
  | "CUSTOMER_PREPAYMENTS"
  | "PAYABLES"
  | "SUPPLIER_PREPAYMENTS"
  | "EMPLOYEE_PAYABLES"
  | "EMPLOYEE_RECEIVABLES"
  | "INVENTORY"
  | "COST_OF_GOODS_SOLD"
  | "DEFAULT_SALES"
  | "DEFAULT_PURCHASE"
  | "ROUNDING_INCOME"
  | "ROUNDING_EXPENSE"
  | "FX_GAIN_LOSS"
  | "BANK_FEES"
  | "VAT_PAYABLE"
  | "RETAINED_EARNINGS"
  | "CURRENT_YEAR_PROFIT";

export type AccountTemplate = {
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  reportLine: string;
  role?: AccountRole;
  vatTurnover?: "SALES" | "PURCHASE";
  /** VatTemplate.code */
  vat?: string;
  isPaymentMethod?: boolean;
};

const A = (
  code: string,
  name: string,
  nameEn: string,
  type: AccountType,
  reportLine: string,
  extra: Partial<AccountTemplate> = {},
): AccountTemplate => ({ code, name, nameEn, type, reportLine, ...extra });

export const BUSINESS_CHART: AccountTemplate[] = [
  // --- Varad --------------------------------------------------------------
  A("1000", "Kassa", "Cash on hand", "ASSET", "BS_CASH", { isPaymentMethod: true }),
  A("1020", "Pangakonto", "Bank account", "ASSET", "BS_CASH", { isPaymentMethod: true }),
  A("1100", "Lühiajalised finantsinvesteeringud", "Short-term financial investments", "ASSET", "BS_ST_INVESTMENTS"),
  A("1200", "Ostjatelt laekumata arved", "Trade receivables", "ASSET", "BS_ST_RECEIVABLES", { role: "RECEIVABLES" }),
  A("1210", "Ebatõenäoliselt laekuvad arved", "Doubtful receivables", "ASSET", "BS_ST_RECEIVABLES"),
  A("1230", "Nõuded aruandvate isikute vastu", "Receivables from employees", "ASSET", "BS_ST_RECEIVABLES", {
    role: "EMPLOYEE_RECEIVABLES",
  }),
  A("1240", "Muud lühiajalised nõuded", "Other short-term receivables", "ASSET", "BS_ST_RECEIVABLES"),
  A("1250", "Lühiajalised laenunõuded", "Short-term loans granted", "ASSET", "BS_ST_RECEIVABLES"),
  A("1270", "Ettemakstud maksud", "Prepaid taxes", "ASSET", "BS_ST_RECEIVABLES"),
  A("1290", "Ettemakstud tulevaste perioodide kulud", "Prepaid expenses", "ASSET", "BS_ST_RECEIVABLES"),
  A("1300", "Tooraine ja materjal", "Raw materials", "ASSET", "BS_INVENTORIES"),
  A("1310", "Lõpetamata toodang", "Work in progress", "ASSET", "BS_INVENTORIES"),
  A("1320", "Valmistoodang", "Finished goods", "ASSET", "BS_INVENTORIES"),
  A("1340", "Müügiks ostetud kaubad", "Goods for resale", "ASSET", "BS_INVENTORIES", { role: "INVENTORY" }),
  A("1350", "Ettemaksed tarnijatele", "Prepayments to suppliers", "ASSET", "BS_ST_RECEIVABLES", {
    role: "SUPPLIER_PREPAYMENTS",
  }),
  A("1500", "Pikaajalised finantsinvesteeringud", "Long-term financial investments", "ASSET", "BS_LT_INVESTMENTS"),
  A("1510", "Osalused tütar- ja sidusettevõtjates", "Investments in subsidiaries and associates", "ASSET", "BS_SUBSIDIARIES"),
  A("1550", "Pikaajalised nõuded", "Long-term receivables", "ASSET", "BS_LT_RECEIVABLES"),
  A("1600", "Kinnisvarainvesteeringud", "Investment property", "ASSET", "BS_INVESTMENT_PROPERTY"),
  A("1700", "Maa", "Land", "ASSET", "BS_PPE"),
  A("1710", "Ehitised", "Buildings", "ASSET", "BS_PPE"),
  A("1720", "Masinad ja seadmed", "Machinery and equipment", "ASSET", "BS_PPE"),
  A("1730", "Transpordivahendid", "Vehicles", "ASSET", "BS_PPE"),
  A("1740", "Inventar ja arvutid", "Fixtures and IT equipment", "ASSET", "BS_PPE"),
  A("1750", "Lõpetamata ehitus ja ettemaksed", "Construction in progress and prepayments", "ASSET", "BS_PPE"),
  A("1790", "Materiaalse põhivara akumuleeritud kulum", "Accumulated depreciation of PPE", "ASSET", "BS_PPE"),
  A("1800", "Immateriaalne põhivara", "Intangible assets", "ASSET", "BS_INTANGIBLES"),
  A("1890", "Immateriaalse põhivara akumuleeritud kulum", "Accumulated amortisation", "ASSET", "BS_INTANGIBLES"),

  // --- Kohustised -----------------------------------------------------------
  A("2000", "Lühiajalised laenud", "Short-term loans", "LIABILITY", "BS_ST_LOANS"),
  A("2010", "Pikaajaliste laenude lühiajaline osa", "Current portion of long-term loans", "LIABILITY", "BS_ST_LOANS"),
  A("2020", "Kapitalirendi lühiajaline kohustis", "Current finance lease liabilities", "LIABILITY", "BS_ST_LOANS"),
  A("2110", "Võlad tarnijatele", "Trade payables", "LIABILITY", "BS_ST_PAYABLES", { role: "PAYABLES" }),
  A("2200", "Võlad töövõtjatele", "Payables to employees", "LIABILITY", "BS_ST_PAYABLES"),
  A("2230", "Puhkusetasude kohustis", "Holiday pay accrual", "LIABILITY", "BS_ST_PAYABLES"),
  A("2300", "Arvestatud käibemaks", "Output VAT", "LIABILITY", "BS_ST_PAYABLES"),
  A("2310", "Sisendkäibemaks", "Input VAT", "LIABILITY", "BS_ST_PAYABLES"),
  A("2315", "Sisendkäibemaksu korrigeerimine", "Input VAT adjustments", "LIABILITY", "BS_ST_PAYABLES"),
  A("2320", "Käibemaksu arveldus", "VAT settlement", "LIABILITY", "BS_ST_PAYABLES", { role: "VAT_PAYABLE" }),
  A("2330", "Ettevõtte tulumaks", "Corporate income tax payable", "LIABILITY", "BS_ST_PAYABLES"),
  A("2340", "Sotsiaalmaks", "Social tax payable", "LIABILITY", "BS_ST_PAYABLES"),
  A("2350", "Üksikisiku tulumaks", "Personal income tax payable", "LIABILITY", "BS_ST_PAYABLES"),
  A("2360", "Töötuskindlustusmakse", "Unemployment insurance payable", "LIABILITY", "BS_ST_PAYABLES"),
  A("2370", "Kohustuslik kogumispension", "Funded pension payable", "LIABILITY", "BS_ST_PAYABLES"),
  A("2380", "Muud maksuvõlad", "Other taxes payable", "LIABILITY", "BS_ST_PAYABLES"),
  A("2410", "Võlad aruandvatele isikutele", "Payables to employees (expense claims)", "LIABILITY", "BS_ST_PAYABLES", {
    role: "EMPLOYEE_PAYABLES",
  }),
  A("2420", "Muud lühiajalised võlad", "Other short-term payables", "LIABILITY", "BS_ST_PAYABLES"),
  A("2430", "Viitvõlad", "Accrued expenses", "LIABILITY", "BS_ST_PAYABLES"),
  A("2500", "Ostjatelt saadud ettemaksed", "Prepayments from customers", "LIABILITY", "BS_ST_PAYABLES", {
    role: "CUSTOMER_PREPAYMENTS",
  }),
  A("2600", "Lühiajalised eraldised", "Short-term provisions", "LIABILITY", "BS_ST_PROVISIONS"),
  A("2650", "Lühiajaline sihtfinantseerimine", "Short-term government grants", "LIABILITY", "BS_ST_GRANTS"),
  A("2700", "Pikaajalised laenud", "Long-term loans", "LIABILITY", "BS_LT_LOANS"),
  A("2710", "Kapitalirendi pikaajaline kohustis", "Long-term finance lease liabilities", "LIABILITY", "BS_LT_LOANS"),
  A("2750", "Muud pikaajalised võlad", "Other long-term payables", "LIABILITY", "BS_LT_PAYABLES"),
  A("2800", "Pikaajalised eraldised", "Long-term provisions", "LIABILITY", "BS_LT_PROVISIONS"),

  // --- Omakapital -----------------------------------------------------------
  A("2900", "Osakapital nimiväärtuses", "Share capital", "EQUITY", "BS_SHARE_CAPITAL"),
  A("2905", "Sissemaksmata osakapital", "Unpaid share capital", "EQUITY", "BS_UNPAID_CAPITAL"),
  A("2910", "Ülekurss", "Share premium", "EQUITY", "BS_SHARE_PREMIUM"),
  A("2920", "Kohustuslik reservkapital", "Statutory reserve", "EQUITY", "BS_STATUTORY_RESERVE"),
  A("2930", "Muud reservid", "Other reserves", "EQUITY", "BS_OTHER_RESERVES"),
  A("2950", "Eelmiste perioodide jaotamata kasum", "Retained earnings", "EQUITY", "BS_RETAINED_EARNINGS", {
    role: "RETAINED_EARNINGS",
  }),
  A("2960", "Aruandeaasta kasum", "Profit for the year", "EQUITY", "BS_CURRENT_PROFIT", { role: "CURRENT_YEAR_PROFIT" }),

  // --- Tulud ------------------------------------------------------------------
  A("3000", "Müügitulu kaupadelt", "Revenue from goods", "INCOME", "IS_REVENUE", { vatTurnover: "SALES", vat: "KM" }),
  A("3010", "Müügitulu teenustelt", "Revenue from services", "INCOME", "IS_REVENUE", {
    vatTurnover: "SALES",
    vat: "KM",
    role: "DEFAULT_SALES",
  }),
  A("3020", "Kaupade müük EL-i", "Goods sold to the EU", "INCOME", "IS_REVENUE", { vatTurnover: "SALES", vat: "0EL" }),
  A("3030", "Teenuste müük EL-i", "Services sold to the EU", "INCOME", "IS_REVENUE", { vatTurnover: "SALES", vat: "ELT" }),
  A("3040", "Eksport", "Exports", "INCOME", "IS_REVENUE", { vatTurnover: "SALES", vat: "0EKS" }),
  A("3050", "Maksuvaba müügitulu", "VAT-exempt revenue", "INCOME", "IS_REVENUE", { vatTurnover: "SALES", vat: "MV" }),
  A("3500", "Muud äritulud", "Other operating income", "INCOME", "IS_OTHER_INCOME"),
  A("3510", "Kasum põhivara müügist", "Gain on disposal of fixed assets", "INCOME", "IS_OTHER_INCOME"),
  A("3520", "Sihtfinantseerimise tulu", "Government grant income", "INCOME", "IS_OTHER_INCOME"),
  A("3590", "Ümardused (tulu)", "Rounding (income)", "INCOME", "IS_OTHER_INCOME", { role: "ROUNDING_INCOME" }),
  A("3800", "Intressitulud", "Interest income", "INCOME", "IS_INTEREST_INCOME"),
  A("3810", "Kasum (kahjum) valuutakursi muutustest", "Foreign exchange gain (loss)", "INCOME", "IS_OTHER_FINANCE", {
    role: "FX_GAIN_LOSS",
  }),
  A("3820", "Muud finantstulud ja -kulud", "Other finance income and costs", "INCOME", "IS_OTHER_FINANCE"),
  A("3830", "Kasum (kahjum) finantsinvesteeringutelt", "Gain (loss) on financial investments", "INCOME", "IS_FIN_INVESTMENTS"),

  // --- Kulud ------------------------------------------------------------------
  A("4000", "Müüdud kaupade soetusmaksumus", "Cost of goods sold", "EXPENSE", "IS_MATERIALS", {
    role: "COST_OF_GOODS_SOLD",
  }),
  A("4010", "Tooraine ja materjal", "Raw materials and consumables", "EXPENSE", "IS_MATERIALS", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4020", "Allhanketööd", "Subcontracted work", "EXPENSE", "IS_MATERIALS", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4100", "Ruumide üür", "Rent", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4110", "Kommunaalkulud", "Utilities", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4120", "Veokite ja masinate kulud", "Vehicle and machinery costs", "EXPENSE", "IS_OTHER_OPEX", {
    vatTurnover: "PURCHASE",
    vat: "KM",
  }),
  A("4125", "Sõiduauto kulud", "Passenger car costs", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "AUTO50" }),
  A("4130", "Lähetuskulud", "Business travel", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4140", "Kontoritarbed", "Office supplies", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4150", "Side ja IT-teenused", "Telecom and IT services", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4160", "Raamatupidamis- ja nõustamisteenused", "Accounting and advisory services", "EXPENSE", "IS_OTHER_OPEX", {
    vatTurnover: "PURCHASE",
    vat: "KM",
  }),
  A("4170", "Turundus ja reklaam", "Marketing and advertising", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4180", "Pangateenustasud", "Bank charges", "EXPENSE", "IS_OTHER_OPEX", { role: "BANK_FEES" }),
  A("4185", "Koolituskulud", "Training", "EXPENSE", "IS_OTHER_OPEX", { vatTurnover: "PURCHASE", vat: "KM" }),
  A("4190", "Muud tegevuskulud", "Other operating expenses", "EXPENSE", "IS_OTHER_OPEX", {
    vatTurnover: "PURCHASE",
    vat: "KM",
    role: "DEFAULT_PURCHASE",
  }),
  A("4200", "Palgakulu", "Wages and salaries", "EXPENSE", "IS_PERSONNEL"),
  A("4210", "Sotsiaalmaks", "Social tax", "EXPENSE", "IS_PERSONNEL"),
  A("4220", "Töötuskindlustusmakse (tööandja)", "Unemployment insurance (employer)", "EXPENSE", "IS_PERSONNEL"),
  A("4300", "Põhivara kulum", "Depreciation and amortisation", "EXPENSE", "IS_DEPRECIATION"),
  A("4400", "Ebatõenäoliselt laekuvad nõuded", "Bad debt expense", "EXPENSE", "IS_OTHER_EXPENSES"),
  A("4410", "Trahvid ja viivised", "Fines and penalties", "EXPENSE", "IS_OTHER_EXPENSES"),
  A("4420", "Kahjum põhivara müügist", "Loss on disposal of fixed assets", "EXPENSE", "IS_OTHER_EXPENSES"),
  A("4490", "Ümardused (kulu)", "Rounding (expense)", "EXPENSE", "IS_OTHER_EXPENSES", { role: "ROUNDING_EXPENSE" }),
  A("4800", "Intressikulud", "Interest expense", "EXPENSE", "IS_INTEREST_EXPENSE"),
  A("4900", "Tulumaks", "Income tax", "EXPENSE", "IS_INCOME_TAX"),
];

export type VatTemplate = {
  code: string;
  name: string;
  nameEn: string;
  kind: "TAXABLE" | "ZERO_EXPORT" | "ZERO_EU_GOODS" | "EU_SERVICES" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_TAXABLE" | "MARGIN";
  deductiblePct?: number;
  invoiceNote?: string;
  /** Konto koodid kontoplaanist */
  salesAccount?: string;
  purchaseAccount?: string;
  periods: Array<{ rate: string; validFrom: string; validTo?: string }>;
};

/** Eesti standardmäära ajalugu. */
const STANDARD_PERIODS = [
  { rate: "20", validFrom: "2009-07-01", validTo: "2023-12-31" },
  { rate: "22", validFrom: "2024-01-01", validTo: "2025-06-30" },
  { rate: "24", validFrom: "2025-07-01" },
];

const ZERO = [{ rate: "0", validFrom: "2000-01-01" }];

export const VAT_TEMPLATES: VatTemplate[] = [
  {
    code: "KM",
    name: "Standardmäär",
    nameEn: "Standard rate",
    kind: "TAXABLE",
    salesAccount: "2300",
    purchaseAccount: "2310",
    periods: STANDARD_PERIODS,
  },
  {
    code: "KM13",
    name: "Majutusteenus",
    nameEn: "Accommodation",
    kind: "TAXABLE",
    salesAccount: "2300",
    purchaseAccount: "2310",
    periods: [
      { rate: "9", validFrom: "2009-07-01", validTo: "2024-12-31" },
      { rate: "13", validFrom: "2025-01-01" },
    ],
  },
  {
    code: "KM9",
    name: "Vähendatud määr (raamatud, ravimid)",
    nameEn: "Reduced rate (books, medicines)",
    kind: "TAXABLE",
    salesAccount: "2300",
    purchaseAccount: "2310",
    periods: [{ rate: "9", validFrom: "2009-07-01" }],
  },
  {
    code: "0EKS",
    name: "0% eksport",
    nameEn: "0% export",
    kind: "ZERO_EXPORT",
    invoiceNote: "Kauba eksport, KMS § 15 lg 3 p 1",
    periods: ZERO,
  },
  {
    code: "0EL",
    name: "0% kaubad EL-i",
    nameEn: "0% intra-community supply of goods",
    kind: "ZERO_EU_GOODS",
    invoiceNote: "Kauba ühendusesisene käive, KMS § 15 lg 4",
    periods: ZERO,
  },
  {
    code: "ELT",
    name: "Teenus EL maksukohustuslasele",
    nameEn: "Services to EU taxable persons",
    kind: "EU_SERVICES",
    invoiceNote: "Pöördmaksustamine",
    periods: ZERO,
  },
  {
    code: "MV",
    name: "Maksuvaba käive",
    nameEn: "VAT exempt",
    kind: "EXEMPT",
    invoiceNote: "Maksuvaba käive, KMS § 16",
    periods: ZERO,
  },
  {
    code: "PM",
    name: "Siseriiklik pöördmaksustamine",
    nameEn: "Domestic reverse charge",
    kind: "REVERSE_CHARGE",
    invoiceNote: "Pöördmaksustamine, KMS § 41¹",
    salesAccount: "2300",
    purchaseAccount: "2310",
    periods: STANDARD_PERIODS,
  },
  {
    code: "AUTO50",
    name: "Sõiduauto (50% mahaarvamine)",
    nameEn: "Passenger car (50% deductible)",
    kind: "TAXABLE",
    deductiblePct: 50,
    salesAccount: "2300",
    purchaseAccount: "2310",
    periods: STANDARD_PERIODS,
  },
  {
    code: "KAS",
    name: "Kasutatud kauba erikord",
    nameEn: "Margin scheme – second-hand goods",
    kind: "MARGIN",
    invoiceNote: "Kasuminormi maksustamise kord – kasutatud kaup, KMS § 41",
    salesAccount: "2300",
    periods: STANDARD_PERIODS,
  },
  {
    code: "REIS",
    name: "Reisiteenuse erikord",
    nameEn: "Margin scheme – travel agents",
    kind: "MARGIN",
    invoiceNote: "Kasuminormi maksustamise kord – reisiteenus, KMS § 40",
    salesAccount: "2300",
    periods: STANDARD_PERIODS,
  },
  {
    code: "-",
    name: "Ei ole käive",
    nameEn: "Outside the scope of VAT",
    kind: "NOT_TAXABLE",
    periods: ZERO,
  },
];

export const DEFAULT_DIMENSIONS = [
  { name: "Projekt", debitPositive: false },
  { name: "Kulukoht", debitPositive: true },
];

export const DEFAULT_NUMBER_SERIES: Array<{
  documentType:
    | "SALES_INVOICE"
    | "CREDIT_INVOICE"
    | "PREPAYMENT_INVOICE"
    | "QUOTE"
    | "PURCHASE_ORDER"
    | "JOURNAL_ENTRY"
    | "PAYMENT"
    | "INTEREST_INVOICE";
  prefix: string;
  nextNumber: number;
}> = [
  { documentType: "SALES_INVOICE", prefix: "", nextNumber: 1001 },
  { documentType: "CREDIT_INVOICE", prefix: "K-", nextNumber: 1 },
  { documentType: "PREPAYMENT_INVOICE", prefix: "E-", nextNumber: 1 },
  { documentType: "QUOTE", prefix: "P-", nextNumber: 1 },
  { documentType: "PURCHASE_ORDER", prefix: "T-", nextNumber: 1 },
  { documentType: "JOURNAL_ENTRY", prefix: "PR-", nextNumber: 1 },
  { documentType: "PAYMENT", prefix: "M-", nextNumber: 1 },
  { documentType: "INTEREST_INVOICE", prefix: "V-", nextNumber: 1 },
];
