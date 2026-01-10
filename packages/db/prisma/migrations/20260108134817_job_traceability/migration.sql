-- AlterTable
ALTER TABLE "Artefact" ADD COLUMN     "jobId" TEXT;

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "jobId" TEXT;

-- CreateIndex
CREATE INDEX "Artefact_jobId_idx" ON "Artefact"("jobId");

-- CreateIndex
CREATE INDEX "Finding_jobId_idx" ON "Finding"("jobId");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artefact" ADD CONSTRAINT "Artefact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
