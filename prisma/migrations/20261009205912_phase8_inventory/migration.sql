-- CreateEnum
CREATE TYPE "CostMethod" AS ENUM ('FIFO', 'AVERAGE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'COUNT', 'SALE', 'PURCHASE');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'STOCK_MOVEMENT';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "costMethod" "CostMethod" NOT NULL DEFAULT 'FIFO';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "cogsAccountId" TEXT,
ADD COLUMN     "inventoryAccountId" TEXT,
ADD COLUMN     "trackStock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "date" DATE NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT,
    "counterAccountId" TEXT,
    "description" TEXT,
    "salesInvoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "journalEntryId" TEXT,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovementLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "countedQuantity" DECIMAL(18,4),
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fixedCost" BOOLEAN NOT NULL DEFAULT false,
    "bookedCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockMovementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_companyId_id_key" ON "Warehouse"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_companyId_code_key" ON "Warehouse"("companyId", "code");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_date_idx" ON "StockMovement"("companyId", "date");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_status_date_idx" ON "StockMovement"("companyId", "status", "date");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_salesInvoiceId_idx" ON "StockMovement"("companyId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_purchaseInvoiceId_idx" ON "StockMovement"("companyId", "purchaseInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_companyId_id_key" ON "StockMovement"("companyId", "id");

-- CreateIndex
CREATE INDEX "StockMovementLine_companyId_movementId_idx" ON "StockMovementLine"("companyId", "movementId");

-- CreateIndex
CREATE INDEX "StockMovementLine_companyId_itemId_idx" ON "StockMovementLine"("companyId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovementLine_companyId_id_key" ON "StockMovementLine"("companyId", "id");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_companyId_movementId_fkey" FOREIGN KEY ("companyId", "movementId") REFERENCES "StockMovement"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "Item"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
