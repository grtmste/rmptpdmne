-- CreateEnum
CREATE TYPE "MoneyAccountKind" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT', 'NETTING');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('SALES_INVOICE', 'PURCHASE_INVOICE', 'EXPENSE_REPORT', 'PREPAYMENT', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "StatementFormat" AS ENUM ('CAMT053', 'CSV');

-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('NEW', 'SUGGESTED', 'DONE', 'IGNORED');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'PAID');

-- AlterTable
ALTER TABLE "ExpenseReport" ADD COLUMN     "paidTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "paidTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "paidTotal" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "MoneyAccountKind" NOT NULL DEFAULT 'BANK',
    "name" TEXT NOT NULL,
    "iban" TEXT,
    "bic" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "accountId" TEXT NOT NULL,
    "showOnInvoice" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "direction" "PaymentDirection" NOT NULL,
    "bankAccountId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "currencyRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amountBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "partyType" "PartyType" NOT NULL DEFAULT 'OTHER',
    "customerId" TEXT,
    "supplierId" TEXT,
    "employeeId" TEXT,
    "partyName" TEXT NOT NULL DEFAULT '',
    "partyIban" TEXT,
    "referenceNumber" TEXT,
    "description" TEXT,
    "statementLineId" TEXT,
    "paymentOrderId" TEXT,
    "journalEntryId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" "AllocationType" NOT NULL,
    "salesInvoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "expenseReportId" TEXT,
    "accountId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "format" "StatementFormat" NOT NULL,
    "fileName" TEXT NOT NULL,
    "externalId" TEXT,
    "fromDate" DATE,
    "toDate" DATE,
    "openingBalance" DECIMAL(18,2),
    "closingBalance" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "partyName" TEXT,
    "partyIban" TEXT,
    "referenceNumber" TEXT,
    "description" TEXT,
    "bankReference" TEXT,
    "status" "StatementLineStatus" NOT NULL DEFAULT 'NEW',
    "suggestion" JSONB,
    "paymentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "messageId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "executionDate" DATE NOT NULL,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrderLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT,
    "expenseReportId" TEXT,
    "partyName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "referenceNumber" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_companyId_id_key" ON "BankAccount"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_companyId_name_key" ON "BankAccount"("companyId", "name");

-- CreateIndex
CREATE INDEX "Payment_companyId_date_idx" ON "Payment"("companyId", "date");

-- CreateIndex
CREATE INDEX "Payment_companyId_status_date_idx" ON "Payment"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "Payment_companyId_bankAccountId_date_idx" ON "Payment"("companyId", "bankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_companyId_id_key" ON "Payment"("companyId", "id");

-- CreateIndex
CREATE INDEX "PaymentAllocation_companyId_paymentId_idx" ON "PaymentAllocation"("companyId", "paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_companyId_salesInvoiceId_idx" ON "PaymentAllocation"("companyId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_companyId_purchaseInvoiceId_idx" ON "PaymentAllocation"("companyId", "purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_companyId_expenseReportId_idx" ON "PaymentAllocation"("companyId", "expenseReportId");

-- CreateIndex
CREATE INDEX "BankStatement_companyId_bankAccountId_createdAt_idx" ON "BankStatement"("companyId", "bankAccountId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_companyId_id_key" ON "BankStatement"("companyId", "id");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_statementId_idx" ON "BankStatementLine"("companyId", "statementId");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_bankAccountId_bankReference_idx" ON "BankStatementLine"("companyId", "bankAccountId", "bankReference");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_companyId_id_key" ON "BankStatementLine"("companyId", "id");

-- CreateIndex
CREATE INDEX "PaymentOrder_companyId_createdAt_idx" ON "PaymentOrder"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_companyId_id_key" ON "PaymentOrder"("companyId", "id");

-- CreateIndex
CREATE INDEX "PaymentOrderLine_companyId_orderId_idx" ON "PaymentOrderLine"("companyId", "orderId");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_companyId_paymentId_fkey" FOREIGN KEY ("companyId", "paymentId") REFERENCES "Payment"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_companyId_statementId_fkey" FOREIGN KEY ("companyId", "statementId") REFERENCES "BankStatement"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrderLine" ADD CONSTRAINT "PaymentOrderLine_companyId_orderId_fkey" FOREIGN KEY ("companyId", "orderId") REFERENCES "PaymentOrder"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Olemasolevatele ettevõtetele pangakonto ja kassa vaikimisi kontodega
INSERT INTO "BankAccount" ("id", "companyId", "kind", "name", "currency", "accountId", "showOnInvoice", "active", "sortOrder", "createdAt", "updatedAt")
SELECT 'ba' || md5(c."id" || t.kind), c."id", t.kind::"MoneyAccountKind", t.name, c."baseCurrency", a."id", t.kind = 'BANK', true, t.sort, NOW(), NOW()
FROM "Company" c
CROSS JOIN (VALUES ('BANK', 'Pangakonto', '1020', 0), ('CASH', 'Kassa', '1000', 1)) AS t(kind, name, code, sort)
JOIN "GlAccount" a ON a."companyId" = c."id" AND a."code" = t.code
WHERE NOT EXISTS (SELECT 1 FROM "BankAccount" b WHERE b."companyId" = c."id");
