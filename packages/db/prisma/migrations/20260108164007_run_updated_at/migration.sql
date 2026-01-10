-- 1) Add column as nullable first (safe with existing rows)
ALTER TABLE "public"."Run"
ADD COLUMN "updatedAt" TIMESTAMP(3);

-- 2) Backfill existing rows
UPDATE "public"."Run"
SET "updatedAt" = COALESCE("createdAt", NOW())
WHERE "updatedAt" IS NULL;

-- 3) Make it NOT NULL (matches Prisma required field)
ALTER TABLE "public"."Run"
ALTER COLUMN "updatedAt" SET NOT NULL;

-- 4) Optional: default for non-Prisma writers (Prisma will still manage @updatedAt)
ALTER TABLE "public"."Run"
ALTER COLUMN "updatedAt" SET DEFAULT NOW();
