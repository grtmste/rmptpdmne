-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedById" TEXT,
ADD COLUMN     "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
ALTER COLUMN "number" DROP NOT NULL;

-- CreateTable
CREATE TABLE "JournalTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "JournalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalTemplateLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2),
    "credit" DECIMAL(18,2),
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JournalTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalTemplate_companyId_id_key" ON "JournalTemplate"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalTemplate_companyId_name_key" ON "JournalTemplate"("companyId", "name");

-- CreateIndex
CREATE INDEX "JournalTemplateLine_companyId_templateId_idx" ON "JournalTemplateLine"("companyId", "templateId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_status_date_idx" ON "JournalEntry"("companyId", "status", "date");

-- AddForeignKey
ALTER TABLE "JournalTemplate" ADD CONSTRAINT "JournalTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalTemplateLine" ADD CONSTRAINT "JournalTemplateLine_companyId_templateId_fkey" FOREIGN KEY ("companyId", "templateId") REFERENCES "JournalTemplate"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalTemplateLine" ADD CONSTRAINT "JournalTemplateLine_companyId_accountId_fkey" FOREIGN KEY ("companyId", "accountId") REFERENCES "GlAccount"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
