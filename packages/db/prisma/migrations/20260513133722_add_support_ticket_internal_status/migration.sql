-- CreateEnum
CREATE TYPE "SupportTicketInternalStatus" AS ENUM ('unread', 'seen', 'in_progress', 'done');

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "internalStatus" "SupportTicketInternalStatus" NOT NULL DEFAULT 'unread';

-- CreateIndex
CREATE INDEX "SupportTicket_internalStatus_createdAt_idx" ON "SupportTicket"("internalStatus", "createdAt");
