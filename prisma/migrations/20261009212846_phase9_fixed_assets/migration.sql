-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- CreateEnum
CREATE TYPE "FixedAssetEventType" AS ENUM ('REVALUATION', 'DISPOSAL', 'RECLASSIFICATION');

-- CreateTable
CREATE TABLE "FixedAssetGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetAccountId" TEXT NOT NULL,
    "accumulatedAccountId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "FixedAssetGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAssetLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "FixedAssetLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "groupId" TEXT NOT NULL,
    "locationId" TEXT,
    "responsibleId" TEXT,
    "serialNumber" TEXT,
    "acquisitionDate" DATE NOT NULL,
    "depreciationStart" DATE NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "residualValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "openingDepreciation" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openingMonths" INTEGER NOT NULL DEFAULT 0,
    "assetAccountId" TEXT NOT NULL,
    "accumulatedAccountId" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "departmentId" TEXT,
    "purchaseInvoiceId" TEXT,
    "disposedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAssetEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "FixedAssetEventType" NOT NULL,
    "date" DATE NOT NULL,
    "costDelta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "accumulatedDelta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fromGroupId" TEXT,
    "toGroupId" TEXT,
    "usefulLifeMonths" INTEGER,
    "counterAccountId" TEXT,
    "description" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "FixedAssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "date" DATE NOT NULL,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "DepreciationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepreciationLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DepreciationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetGroup_companyId_id_key" ON "FixedAssetGroup"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetGroup_companyId_name_key" ON "FixedAssetGroup"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetLocation_companyId_id_key" ON "FixedAssetLocation"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetLocation_companyId_name_key" ON "FixedAssetLocation"("companyId", "name");

-- CreateIndex
CREATE INDEX "FixedAsset_companyId_status_idx" ON "FixedAsset"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_companyId_id_key" ON "FixedAsset"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_companyId_code_key" ON "FixedAsset"("companyId", "code");

-- CreateIndex
CREATE INDEX "FixedAssetEvent_companyId_assetId_idx" ON "FixedAssetEvent"("companyId", "assetId");

-- CreateIndex
CREATE INDEX "FixedAssetEvent_companyId_date_idx" ON "FixedAssetEvent"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetEvent_companyId_id_key" ON "FixedAssetEvent"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationRun_companyId_id_key" ON "DepreciationRun"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationRun_companyId_period_key" ON "DepreciationRun"("companyId", "period");

-- CreateIndex
CREATE INDEX "DepreciationLine_companyId_assetId_idx" ON "DepreciationLine"("companyId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationLine_companyId_id_key" ON "DepreciationLine"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DepreciationLine_runId_assetId_key" ON "DepreciationLine"("runId", "assetId");

-- AddForeignKey
ALTER TABLE "FixedAssetGroup" ADD CONSTRAINT "FixedAssetGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAssetLocation" ADD CONSTRAINT "FixedAssetLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_companyId_groupId_fkey" FOREIGN KEY ("companyId", "groupId") REFERENCES "FixedAssetGroup"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "FixedAssetLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAssetEvent" ADD CONSTRAINT "FixedAssetEvent_companyId_assetId_fkey" FOREIGN KEY ("companyId", "assetId") REFERENCES "FixedAsset"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationRun" ADD CONSTRAINT "DepreciationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationLine" ADD CONSTRAINT "DepreciationLine_companyId_runId_fkey" FOREIGN KEY ("companyId", "runId") REFERENCES "DepreciationRun"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepreciationLine" ADD CONSTRAINT "DepreciationLine_companyId_assetId_fkey" FOREIGN KEY ("companyId", "assetId") REFERENCES "FixedAsset"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
