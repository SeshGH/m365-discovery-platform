-- CreateEnum
CREATE TYPE "TenantAuthMode" AS ENUM ('MULTI_TENANT_APP');

-- DropIndex
DROP INDEX "Job_runId_idx";

-- DropIndex
DROP INDEX "Job_status_idx";

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "collectorId" TEXT NOT NULL DEFAULT 'entra.users',
ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "Run" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "TenantAuth" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" "TenantAuthMode" NOT NULL DEFAULT 'MULTI_TENANT_APP',
    "consentedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantAuth_tenantId_key" ON "TenantAuth"("tenantId");

-- CreateIndex
CREATE INDEX "TenantAuth_status_idx" ON "TenantAuth"("status");

-- CreateIndex
CREATE INDEX "Job_runId_status_idx" ON "Job"("runId", "status");

-- CreateIndex
CREATE INDEX "Job_collectorId_status_idx" ON "Job"("collectorId", "status");

-- AddForeignKey
ALTER TABLE "TenantAuth" ADD CONSTRAINT "TenantAuth_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
