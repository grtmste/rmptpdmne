-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('BUSINESS', 'SOLE_PROPRIETOR', 'NONPROFIT');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('DETAIL', 'SUMMARY');

-- CreateEnum
CREATE TYPE "VatTurnover" AS ENUM ('NONE', 'SALES', 'PURCHASE');

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('RECEIVABLES', 'CUSTOMER_PREPAYMENTS', 'PAYABLES', 'SUPPLIER_PREPAYMENTS', 'EMPLOYEE_PAYABLES', 'EMPLOYEE_RECEIVABLES', 'INVENTORY', 'COST_OF_GOODS_SOLD', 'DEFAULT_SALES', 'DEFAULT_PURCHASE', 'ROUNDING_INCOME', 'ROUNDING_EXPENSE', 'FX_GAIN_LOSS', 'BANK_FEES', 'VAT_PAYABLE', 'RETAINED_EARNINGS', 'CURRENT_YEAR_PROFIT');

-- CreateEnum
CREATE TYPE "VatKind" AS ENUM ('TAXABLE', 'ZERO_EXPORT', 'ZERO_EU_GOODS', 'EU_SERVICES', 'EXEMPT', 'REVERSE_CHARGE', 'NOT_TAXABLE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('SALES_INVOICE', 'CREDIT_INVOICE', 'PREPAYMENT_INVOICE', 'QUOTE', 'PURCHASE_ORDER', 'JOURNAL_ENTRY', 'PAYMENT', 'INTEREST_INVOICE');

-- CreateEnum
CREATE TYPE "DimensionKind" AS ENUM ('DETAIL', 'SUMMARY');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('OPENING_BALANCE', 'MANUAL', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'PAYMENT', 'INVENTORY', 'DEPRECIATION', 'VAT_CLOSING', 'YEAR_END');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "accountingStartDate" DATE,
ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressCounty" TEXT,
ADD COLUMN     "addressPostalCode" TEXT,
ADD COLUMN     "addressStreet" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "incomeStatementScheme" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lockedUntil" DATE,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "type" "CompanyType" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "type" "AccountType" NOT NULL,
    "kind" "AccountKind" NOT NULL DEFAULT 'DETAIL',
    "reportLine" TEXT,
    "defaultVatRateId" TEXT,
    "vatTurnover" "VatTurnover" NOT NULL DEFAULT 'NONE',
    "isPaymentMethod" BOOLEAN NOT NULL DEFAULT false,
    "requiresDepartment" BOOLEAN NOT NULL DEFAULT false,
    "requiredDimensionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "showOnDashboard" BOOLEAN NOT NULL DEFAULT false,
    "role" "AccountRole",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VatRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "kind" "VatKind" NOT NULL DEFAULT 'TAXABLE',
    "deductiblePct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "invoiceNote" TEXT,
    "salesAccountId" TEXT,
    "purchaseAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "VatRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VatRatePeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vatRateId" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VatRatePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSeries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "yearBased" BOOLEAN NOT NULL DEFAULT false,
    "padding" INTEGER NOT NULL DEFAULT 0,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "NumberSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSeriesCounter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberSeriesCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyCurrency" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyCurrency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ECB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dimension" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DimensionKind" NOT NULL DEFAULT 'DETAIL',
    "parentId" TEXT,
    "debitPositive" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DimensionValue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "DimensionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" "JournalSource" NOT NULL,
    "sourceId" TEXT,
    "description" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "departmentId" TEXT,
    "vatRateId" TEXT,
    "vatAmount" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLineDimension" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "dimensionValueId" TEXT NOT NULL,

    CONSTRAINT "JournalLineDimension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlAccount_companyId_type_idx" ON "GlAccount"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_companyId_id_key" ON "GlAccount"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_companyId_code_key" ON "GlAccount"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_companyId_role_key" ON "GlAccount"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "VatRate_companyId_id_key" ON "VatRate"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VatRate_companyId_code_key" ON "VatRate"("companyId", "code");

-- CreateIndex
CREATE INDEX "VatRatePeriod_companyId_vatRateId_validFrom_idx" ON "VatRatePeriod"("companyId", "vatRateId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_id_key" ON "FiscalYear"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_companyId_startDate_key" ON "FiscalYear"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeries_companyId_id_key" ON "NumberSeries"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeries_companyId_documentType_key" ON "NumberSeries"("companyId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeriesCounter_companyId_seriesId_year_key" ON "NumberSeriesCounter"("companyId", "seriesId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCurrency_companyId_code_key" ON "CompanyCurrency"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_currency_date_key" ON "ExchangeRate"("currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_id_key" ON "Department"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Dimension_companyId_id_key" ON "Dimension"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Dimension_companyId_name_key" ON "Dimension"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionValue_companyId_id_key" ON "DimensionValue"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DimensionValue_companyId_dimensionId_code_key" ON "DimensionValue"("companyId", "dimensionId", "code");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_date_idx" ON "JournalEntry"("companyId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_source_sourceId_idx" ON "JournalEntry"("companyId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_id_key" ON "JournalEntry"("companyId", "id");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_accountId_idx" ON "JournalLine"("companyId", "accountId");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_entryId_idx" ON "JournalLine"("companyId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_companyId_id_key" ON "JournalLine"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLineDimension_companyId_lineId_dimensionValueId_key" ON "JournalLineDimension"("companyId", "lineId", "dimensionValueId");

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_defaultVatRateId_fkey" FOREIGN KEY ("defaultVatRateId") REFERENCES "VatRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VatRate" ADD CONSTRAINT "VatRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VatRate" ADD CONSTRAINT "VatRate_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VatRate" ADD CONSTRAINT "VatRate_purchaseAccountId_fkey" FOREIGN KEY ("purchaseAccountId") REFERENCES "GlAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VatRatePeriod" ADD CONSTRAINT "VatRatePeriod_companyId_vatRateId_fkey" FOREIGN KEY ("companyId", "vatRateId") REFERENCES "VatRate"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberSeries" ADD CONSTRAINT "NumberSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberSeriesCounter" ADD CONSTRAINT "NumberSeriesCounter_companyId_seriesId_fkey" FOREIGN KEY ("companyId", "seriesId") REFERENCES "NumberSeries"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCurrency" ADD CONSTRAINT "CompanyCurrency_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dimension" ADD CONSTRAINT "Dimension_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dimension" ADD CONSTRAINT "Dimension_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Dimension"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DimensionValue" ADD CONSTRAINT "DimensionValue_companyId_dimensionId_fkey" FOREIGN KEY ("companyId", "dimensionId") REFERENCES "Dimension"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_entryId_fkey" FOREIGN KEY ("companyId", "entryId") REFERENCES "JournalEntry"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_accountId_fkey" FOREIGN KEY ("companyId", "accountId") REFERENCES "GlAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "VatRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLineDimension" ADD CONSTRAINT "JournalLineDimension_companyId_lineId_fkey" FOREIGN KEY ("companyId", "lineId") REFERENCES "JournalLine"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLineDimension" ADD CONSTRAINT "JournalLineDimension_companyId_dimensionValueId_fkey" FOREIGN KEY ("companyId", "dimensionValueId") REFERENCES "DimensionValue"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
