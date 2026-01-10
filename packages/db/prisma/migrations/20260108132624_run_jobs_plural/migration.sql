-- DropForeignKey
ALTER TABLE "Artefact" DROP CONSTRAINT "Artefact_runId_fkey";

-- DropForeignKey
ALTER TABLE "Finding" DROP CONSTRAINT "Finding_runId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_runId_fkey";

-- DropForeignKey
ALTER TABLE "Run" DROP CONSTRAINT "Run_tenantId_fkey";

-- DropIndex
DROP INDEX "Job_runId_key";

-- CreateIndex
CREATE INDEX "Artefact_type_idx" ON "Artefact"("type");

-- CreateIndex
CREATE INDEX "Artefact_createdAt_idx" ON "Artefact"("createdAt");

-- CreateIndex
CREATE INDEX "Finding_createdAt_idx" ON "Finding"("createdAt");

-- CreateIndex
CREATE INDEX "Job_runId_idx" ON "Job"("runId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_lockedAt_idx" ON "Job"("lockedAt");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- CreateIndex
CREATE INDEX "Run_tenantId_idx" ON "Run"("tenantId");

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artefact" ADD CONSTRAINT "Artefact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
