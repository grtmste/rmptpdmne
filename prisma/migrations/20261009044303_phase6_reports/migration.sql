-- CreateEnum
CREATE TYPE "CostFunction" AS ENUM ('COST_OF_SALES', 'DISTRIBUTION', 'ADMIN');

-- AlterTable
ALTER TABLE "GlAccount" ADD COLUMN     "costFunction" "CostFunction";

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "dashboard" JSONB;
