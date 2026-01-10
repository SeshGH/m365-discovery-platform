-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('identity', 'access', 'application_permissions', 'tenant_configuration', 'audit_and_logging', 'data_protection', 'device_management', 'other');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'false_positive');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "category" "FindingCategory" NOT NULL DEFAULT 'other',
ADD COLUMN     "confidence" "Confidence" NOT NULL DEFAULT 'medium',
ADD COLUMN     "ruleId" TEXT,
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "status" "FindingStatus" NOT NULL DEFAULT 'open',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "severity" SET DEFAULT 'info';

-- CreateIndex
CREATE INDEX "Finding_category_idx" ON "Finding"("category");

-- CreateIndex
CREATE INDEX "Finding_confidence_idx" ON "Finding"("confidence");

-- CreateIndex
CREATE INDEX "Finding_status_idx" ON "Finding"("status");

-- CreateIndex
CREATE INDEX "Finding_score_idx" ON "Finding"("score");

-- CreateIndex
CREATE INDEX "Finding_ruleId_idx" ON "Finding"("ruleId");
