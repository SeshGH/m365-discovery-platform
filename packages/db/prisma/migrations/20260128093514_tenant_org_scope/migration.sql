-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "orgId" TEXT;

-- CreateIndex
CREATE INDEX "Tenant_orgId_idx" ON "Tenant"("orgId");
