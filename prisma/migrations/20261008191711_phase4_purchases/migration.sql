-- CreateEnum
CREATE TYPE "PurchaseSource" AS ENUM ('MANUAL', 'UPLOAD', 'ORDER');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttachmentStorage" AS ENUM ('BLOB', 'DATABASE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'PURCHASE_INVOICE';
ALTER TYPE "DocumentType" ADD VALUE 'EXPENSE_REPORT';

-- CreateTable
CREATE TABLE "SupplierGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "SupplierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
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
    "phone" TEXT,
    "contactPerson" TEXT,
    "bankAccount" TEXT,
    "referenceNumber" TEXT,
    "paymentTermDays" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "groupId" TEXT,
    "defaultAccountId" TEXT,
    "defaultVatRateId" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personalCode" TEXT,
    "email" TEXT,
    "bankAccount" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "isCredit" BOOLEAN NOT NULL DEFAULT false,
    "source" "PurchaseSource" NOT NULL DEFAULT 'MANUAL',
    "number" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL DEFAULT '',
    "supplierRegCode" TEXT,
    "supplierVatNumber" TEXT,
    "invoiceNumber" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "referenceNumber" TEXT,
    "bankAccount" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "currencyRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "creditOfId" TEXT,
    "purchaseOrderId" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseInvoiceLine" (
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
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reverseVatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductibleVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "expectedDate" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
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
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "netTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ExpenseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseReportLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "vendor" TEXT,
    "documentNumber" TEXT,
    "description" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "vatRateId" TEXT,
    "vatPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductibleVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "departmentId" TEXT,
    "dimensionValueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseReportLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage" "AttachmentStorage" NOT NULL,
    "url" TEXT,
    "data" BYTEA,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierGroup_companyId_id_key" ON "SupplierGroup"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierGroup_companyId_name_key" ON "SupplierGroup"("companyId", "name");

-- CreateIndex
CREATE INDEX "Supplier_companyId_name_idx" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE INDEX "Supplier_companyId_regCode_idx" ON "Supplier"("companyId", "regCode");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_id_key" ON "Supplier"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_id_key" ON "Employee"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_name_key" ON "Employee"("companyId", "name");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_companyId_date_idx" ON "PurchaseInvoice"("companyId", "date");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_companyId_status_date_idx" ON "PurchaseInvoice"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_companyId_supplierId_idx" ON "PurchaseInvoice"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_companyId_id_key" ON "PurchaseInvoice"("companyId", "id");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceLine_companyId_invoiceId_idx" ON "PurchaseInvoiceLine"("companyId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoiceLine_companyId_id_key" ON "PurchaseInvoiceLine"("companyId", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_date_idx" ON "PurchaseOrder"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_id_key" ON "PurchaseOrder"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_number_key" ON "PurchaseOrder"("companyId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_companyId_orderId_idx" ON "PurchaseOrderLine"("companyId", "orderId");

-- CreateIndex
CREATE INDEX "ExpenseReport_companyId_date_idx" ON "ExpenseReport"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseReport_companyId_id_key" ON "ExpenseReport"("companyId", "id");

-- CreateIndex
CREATE INDEX "ExpenseReportLine_companyId_reportId_idx" ON "ExpenseReportLine"("companyId", "reportId");

-- CreateIndex
CREATE INDEX "Attachment_companyId_documentType_documentId_idx" ON "Attachment"("companyId", "documentType", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_companyId_id_key" ON "Attachment"("companyId", "id");

-- AddForeignKey
ALTER TABLE "SupplierGroup" ADD CONSTRAINT "SupplierGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SupplierGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_creditOfId_fkey" FOREIGN KEY ("creditOfId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_companyId_invoiceId_fkey" FOREIGN KEY ("companyId", "invoiceId") REFERENCES "PurchaseInvoice"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_supplierId_fkey" FOREIGN KEY ("companyId", "supplierId") REFERENCES "Supplier"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "PurchaseOrder"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseReport" ADD CONSTRAINT "ExpenseReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseReport" ADD CONSTRAINT "ExpenseReport_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "Employee"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseReportLine" ADD CONSTRAINT "ExpenseReportLine_companyId_reportId_fkey" FOREIGN KEY ("companyId", "reportId") REFERENCES "ExpenseReport"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
