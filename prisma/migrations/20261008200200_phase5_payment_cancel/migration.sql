-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cancelEntryId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);
