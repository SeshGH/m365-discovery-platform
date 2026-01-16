-- CreateIndex
CREATE INDEX "ObservedCheck_runId_observedAt_idx" ON "ObservedCheck"("runId", "observedAt");

-- CreateIndex
CREATE INDEX "ObservedCheck_runId_collectorId_idx" ON "ObservedCheck"("runId", "collectorId");

-- CreateIndex
CREATE INDEX "ObservedCheck_runId_checkId_idx" ON "ObservedCheck"("runId", "checkId");
