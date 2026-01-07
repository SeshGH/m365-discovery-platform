/*
  Warnings:

  - Added the required column `bucket` to the `Artefact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `key` to the `Artefact` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Artefact" ADD COLUMN     "bucket" TEXT NOT NULL,
ADD COLUMN     "key" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Artefact_bucket_key_idx" ON "Artefact"("bucket", "key");
