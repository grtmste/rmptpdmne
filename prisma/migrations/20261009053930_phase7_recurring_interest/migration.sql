-- CreateEnum
CREATE TYPE "RecurringMode" AS ENUM ('DRAFT', 'CONFIRM', 'SEND');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "interestAccountId" TEXT,
ADD COLUMN     "reminderText" TEXT,
ADD COLUMN     "statementText" TEXT;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "isInterest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurringInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mode" "RecurringMode" NOT NULL DEFAULT 'DRAFT',
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "nextDate" DATE,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "paymentTermDays" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "yourReference" TEXT,
    "notes" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "itemId" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRateId" TEXT,
    "accountId" TEXT,
    "departmentId" TEXT,
    "dimensionValueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecurringInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateInterestCharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "interestInvoiceId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LateInterestCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringInvoice_companyId_active_nextDate_idx" ON "RecurringInvoice"("companyId", "active", "nextDate");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoice_companyId_id_key" ON "RecurringInvoice"("companyId", "id");

-- CreateIndex
CREATE INDEX "RecurringInvoiceLine_companyId_recurringId_idx" ON "RecurringInvoiceLine"("companyId", "recurringId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringInvoiceLine_companyId_id_key" ON "RecurringInvoiceLine"("companyId", "id");

-- CreateIndex
CREATE INDEX "LateInterestCharge_companyId_salesInvoiceId_idx" ON "LateInterestCharge"("companyId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "LateInterestCharge_companyId_interestInvoiceId_idx" ON "LateInterestCharge"("companyId", "interestInvoiceId");

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceLine" ADD CONSTRAINT "RecurringInvoiceLine_companyId_recurringId_fkey" FOREIGN KEY ("companyId", "recurringId") REFERENCES "RecurringInvoice"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateInterestCharge" ADD CONSTRAINT "LateInterestCharge_interestInvoiceId_fkey" FOREIGN KEY ("interestInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateInterestCharge" ADD CONSTRAINT "LateInterestCharge_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
