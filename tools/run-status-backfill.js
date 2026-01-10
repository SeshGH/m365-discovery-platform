const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const sql = `
UPDATE "Run" r
SET
  "status" = CASE
    WHEN EXISTS (SELECT 1 FROM "Job" j WHERE j."runId" = r."id" AND j."status" = 'failed') THEN 'failed'
    WHEN EXISTS (SELECT 1 FROM "Job" j WHERE j."runId" = r."id" AND j."status" = 'running') THEN 'running'
    WHEN EXISTS (SELECT 1 FROM "Job" j WHERE j."runId" = r."id" AND j."status" = 'queued') THEN 'queued'
    WHEN EXISTS (SELECT 1 FROM "Job" j WHERE j."runId" = r."id" AND j."status" = 'succeeded') THEN 'succeeded'
    ELSE r."status"
  END,
  "startedAt" = COALESCE(
    r."startedAt",
    (SELECT MIN(j."lockedAt") FROM "Job" j WHERE j."runId" = r."id")
  ),
  "endedAt" = CASE
    WHEN EXISTS (SELECT 1 FROM "Job" j WHERE j."runId" = r."id" AND j."status" IN ('queued','running')) THEN NULL
    ELSE COALESCE(
      r."endedAt",
      (SELECT MAX(j."updatedAt") FROM "Job" j WHERE j."runId" = r."id")
    )
  END,
  "updatedAt" = NOW();
`;

  const updated = await prisma.$executeRawUnsafe(sql);
  console.log("Rows updated:", updated);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
