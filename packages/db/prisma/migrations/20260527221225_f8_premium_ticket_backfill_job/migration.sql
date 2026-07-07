-- F8.06: PremiumTicketBackfillJob — DB-backed job queue for post-commit premium
-- ticket backfill. Rows are inserted post-commit by applyMembershipEvent callers
-- on subscription.activated (canon §F8.4). Polled by the premium-ticket-backfill
-- worker every minute; rows transition pending → processing → completed/failed.

-- CreateEnum
CREATE TYPE "PremiumTicketBackfillJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "PremiumTicketBackfillJob" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "status" "PremiumTicketBackfillJobStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumTicketBackfillJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PremiumTicketBackfillJob_status_createdAt_idx" ON "PremiumTicketBackfillJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PremiumTicketBackfillJob_garageId_idx" ON "PremiumTicketBackfillJob"("garageId");

-- AddForeignKey
ALTER TABLE "PremiumTicketBackfillJob" ADD CONSTRAINT "PremiumTicketBackfillJob_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
