-- CreateTable
CREATE TABLE "ObservedCheck" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "jobId" TEXT,
    "checkId" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "ruleId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL DEFAULT '{}',
    "references" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ObservedCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObservedCheck_runId_idx" ON "ObservedCheck"("runId");

-- CreateIndex
CREATE INDEX "ObservedCheck_jobId_idx" ON "ObservedCheck"("jobId");

-- CreateIndex
CREATE INDEX "ObservedCheck_checkId_idx" ON "ObservedCheck"("checkId");

-- CreateIndex
CREATE INDEX "ObservedCheck_collectorId_idx" ON "ObservedCheck"("collectorId");

-- CreateIndex
CREATE INDEX "ObservedCheck_ruleId_idx" ON "ObservedCheck"("ruleId");

-- CreateIndex
CREATE INDEX "ObservedCheck_observedAt_idx" ON "ObservedCheck"("observedAt");

-- AddForeignKey
ALTER TABLE "ObservedCheck" ADD CONSTRAINT "ObservedCheck_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservedCheck" ADD CONSTRAINT "ObservedCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
