-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CheckConstraints: enforce lifecycle invariants between status and timestamps
ALTER TABLE "User" ADD CONSTRAINT "User_deleted_requires_deletedAt"
  CHECK (status <> 'deleted' OR "deletedAt" IS NOT NULL);

ALTER TABLE "User" ADD CONSTRAINT "User_anonymized_requires_anonymizedAt"
  CHECK (status <> 'anonymized' OR "anonymizedAt" IS NOT NULL);

ALTER TABLE "User" ADD CONSTRAINT "User_deletedAt_requires_deleted_status"
  CHECK ("deletedAt" IS NULL OR status IN ('deleted', 'anonymized'));

ALTER TABLE "User" ADD CONSTRAINT "User_anonymizedAt_requires_anonymized_status"
  CHECK ("anonymizedAt" IS NULL OR status = 'anonymized');
