CREATE TABLE "UploadDeletionQueue" (
  "id" TEXT NOT NULL,
  "objectKey" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(80),
  "deleteAfter" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UploadDeletionQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadDeletionQueue_objectKey_key" ON "UploadDeletionQueue"("objectKey");
CREATE INDEX "UploadDeletionQueue_deleteAfter_idx" ON "UploadDeletionQueue"("deleteAfter");
CREATE INDEX "UploadDeletionQueue_createdAt_idx" ON "UploadDeletionQueue"("createdAt");
