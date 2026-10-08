-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "SalesInvoiceType" AS ENUM ('INVOICE', 'CREDIT', 'PREPAYMENT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'INVOICED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED');

-- AlterEnum
ALTER TYPE "VatKind" ADD VALUE 'MARGIN';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "invoiceAccent" TEXT NOT NULL DEFAULT '#0f5c55',
ADD COLUMN     "invoiceBankDetails" TEXT,
ADD COLUMN     "invoiceFooter" TEXT,
ADD COLUMN     "invoiceNote" TEXT,
ADD COLUMN     "lateInterestPct" DECIMAL(6,3) NOT NULL DEFAULT 0.05,
ADD COLUMN     "paymentTermDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPerson" BOOLEAN NOT NULL DEFAULT false,
    "regCode" TEXT,
    "vatNumber" TEXT,
    "countryCode" CHAR(2) NOT NULL DEFAULT 'EE',
    "addressStreet" TEXT,
    "addressCity" TEXT,
    "addressPostalCode" TEXT,
    "addressCounty" TEXT,
    "email" TEXT,
    "emailCc" TEXT,
    "phone" TEXT,
    "contactPerson" TEXT,
    "paymentTermDays" INTEGER,
    "lateInterestPct" DECIMAL(6,3),
    "locale" TEXT NOT NULL DEFAULT 'et',
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "referenceNumber" TEXT,
    "groupId" TEXT,
    "defaultVatRateId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "type" "ItemType" NOT NULL DEFAULT 'SERVICE',
    "unit" TEXT,
    "salePrice" DECIMAL(18,4),
    "purchasePrice" DECIMAL(18,4),
    "vatRateId" TEXT,
    "salesAccountId" TEXT,
    "purchaseAccountId" TEXT,
    "groupId" TEXT,
    "forSales" BOOLEAN NOT NULL DEFAULT true,
    "forPurchases" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "SalesInvoiceType" NOT NULL DEFAULT 'INVOICE',
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerRegCode" TEXT,
    "customerVatNumber" TEXT,
    "customerAddress" TEXT,
    "customerEmail" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "referenceNumber" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "currencyRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'et',
    "yourReference" TEXT,
    "notes" TEXT,
    "lateInterestPct" DECIMAL(6,3),
    "creditOfId" TEXT,
    "taxFree" BOOLEAN NOT NULL DEFAULT false,
    "quoteId" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesInvoiceLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRateId" TEXT,
    "vatPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "departmentId" TEXT,
    "dimensionValueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitCost" DECIMAL(18,4),
    "prepaymentInvoiceId" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "marginVatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerRegCode" TEXT,
    "customerVatNumber" TEXT,
    "customerAddress" TEXT,
    "customerEmail" TEXT,
    "date" DATE NOT NULL,
    "validUntil" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'et',
    "yourReference" TEXT,
    "notes" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "itemId" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRateId" TEXT,
    "vatPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "departmentId" TEXT,
    "dimensionValueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitCost" DECIMAL(18,4),
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "error" TEXT,
    "providerId" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_companyId_id_key" ON "CustomerGroup"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_companyId_name_key" ON "CustomerGroup"("companyId", "name");

-- CreateIndex
CREATE INDEX "Customer_companyId_name_idx" ON "Customer"("companyId", "name");

-- CreateIndex
CREATE INDEX "Customer_companyId_regCode_idx" ON "Customer"("companyId", "regCode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_id_key" ON "Customer"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_companyId_id_key" ON "ItemGroup"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_companyId_name_key" ON "ItemGroup"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Item_companyId_id_key" ON "Item"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Item_companyId_code_key" ON "Item"("companyId", "code");

-- CreateIndex
CREATE INDEX "SalesInvoice_companyId_date_idx" ON "SalesInvoice"("companyId", "date");

-- CreateIndex
CREATE INDEX "SalesInvoice_companyId_status_date_idx" ON "SalesInvoice"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "SalesInvoice_companyId_customerId_idx" ON "SalesInvoice"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "SalesInvoice_companyId_number_idx" ON "SalesInvoice"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_companyId_id_key" ON "SalesInvoice"("companyId", "id");

-- CreateIndex
CREATE INDEX "SalesInvoiceLine_companyId_invoiceId_idx" ON "SalesInvoiceLine"("companyId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoiceLine_companyId_id_key" ON "SalesInvoiceLine"("companyId", "id");

-- CreateIndex
CREATE INDEX "Quote_companyId_date_idx" ON "Quote"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_companyId_id_key" ON "Quote"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_companyId_number_key" ON "Quote"("companyId", "number");

-- CreateIndex
CREATE INDEX "QuoteLine_companyId_quoteId_idx" ON "QuoteLine"("companyId", "quoteId");

-- CreateIndex
CREATE INDEX "EmailLog_companyId_documentType_documentId_idx" ON "EmailLog"("companyId", "documentType", "documentId");

-- CreateIndex
CREATE INDEX "EmailLog_companyId_createdAt_idx" ON "EmailLog"("companyId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_creditOfId_fkey" FOREIGN KEY ("creditOfId") REFERENCES "SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceLine" ADD CONSTRAINT "SalesInvoiceLine_companyId_invoiceId_fkey" FOREIGN KEY ("companyId", "invoiceId") REFERENCES "SalesInvoice"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_customerId_fkey" FOREIGN KEY ("companyId", "customerId") REFERENCES "Customer"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_companyId_quoteId_fkey" FOREIGN KEY ("companyId", "quoteId") REFERENCES "Quote"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
