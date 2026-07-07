-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "DataExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'pending',
    "objectKey" VARCHAR(300),
    "errorMessage" VARCHAR(500),
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExportJob_userId_createdAt_idx" ON "DataExportJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DataExportJob_status_idx" ON "DataExportJob"("status");

-- AddForeignKey
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
