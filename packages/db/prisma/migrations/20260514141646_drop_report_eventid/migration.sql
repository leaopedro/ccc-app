/*
  Warnings:

  - You are about to drop the column `eventId` on the `Report` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_eventId_fkey";

-- DropIndex
DROP INDEX "Report_eventId_status_createdAt_idx";

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "eventId";

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt" DESC);
