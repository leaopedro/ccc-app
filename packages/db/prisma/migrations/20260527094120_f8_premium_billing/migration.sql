-- CreateEnum
CREATE TYPE "PremiumProvider" AS ENUM ('stripe', 'apple_revenuecat');

-- CreateEnum
CREATE TYPE "PremiumCadence" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "PremiumMembershipStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancel_scheduled', 'expired', 'paused');

-- AlterTable
ALTER TABLE "TicketTier" ADD COLUMN     "isPremiumGrantable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PremiumMembership" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "provider" "PremiumProvider" NOT NULL,
    "providerCustomerRef" VARCHAR(120) NOT NULL,
    "providerSubRef" VARCHAR(120) NOT NULL,
    "tier" "GaragePremiumTier" NOT NULL,
    "cadence" "PremiumCadence" NOT NULL,
    "status" "PremiumMembershipStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "baseAmountCents" INTEGER NOT NULL,
    "devFeePercent" INTEGER NOT NULL,
    "devFeeAmountCents" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumMembershipInvoice" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "provider" "PremiumProvider" NOT NULL,
    "providerInvoiceRef" VARCHAR(120) NOT NULL,
    "providerTransactionRef" VARCHAR(200),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "baseAmountCents" INTEGER NOT NULL,
    "devFeePercent" INTEGER NOT NULL,
    "devFeeAmountCents" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "refundedAmountCents" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumMembershipInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PremiumProvider" NOT NULL,
    "providerEventId" VARCHAR(200) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PremiumMembership_garageId_status_idx" ON "PremiumMembership"("garageId", "status");

-- CreateIndex
CREATE INDEX "PremiumMembership_currentPeriodEnd_idx" ON "PremiumMembership"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumMembership_provider_providerSubRef_key" ON "PremiumMembership"("provider", "providerSubRef");

-- CreateIndex
CREATE INDEX "PremiumMembershipInvoice_membershipId_periodStart_idx" ON "PremiumMembershipInvoice"("membershipId", "periodStart");

-- CreateIndex
CREATE INDEX "PremiumMembershipInvoice_paidAt_idx" ON "PremiumMembershipInvoice"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumMembershipInvoice_provider_providerInvoiceRef_key" ON "PremiumMembershipInvoice"("provider", "providerInvoiceRef");

-- CreateIndex
CREATE INDEX "SubscriptionWebhookEvent_receivedAt_idx" ON "SubscriptionWebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionWebhookEvent_provider_providerEventId_key" ON "SubscriptionWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "TicketTier_eventId_isPremiumGrantable_idx" ON "TicketTier"("eventId", "isPremiumGrantable");

-- AddForeignKey
ALTER TABLE "PremiumMembership" ADD CONSTRAINT "PremiumMembership_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumMembershipInvoice" ADD CONSTRAINT "PremiumMembershipInvoice_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "PremiumMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw partial unique: one live PremiumMembership row per garage (spec §2.2 + canon §F8)
-- Expired rows accumulate as history. Re-subscribe = fresh row insert.
CREATE UNIQUE INDEX premium_membership_live_per_garage
  ON "PremiumMembership" ("garageId")
  WHERE status IN ('active', 'past_due', 'cancel_scheduled');

-- Raw partial unique: one valid premium_grant Ticket per (user, event) (spec §2.6 + canon §F8.8).
-- Scope is NARROWED to source='premium_grant'. The broader (status='valid') variant was
-- dropped earlier — see migration 20260503163319_drop_ticket_user_event_unique — because
-- multi-ticket purchases (Event.maxTicketsPerUser > 1) and comp grants legitimately
-- create multiple valid tickets per (userId, eventId). F8.06 backfill worker + F8.07
-- publish-hook only ever create source='premium_grant' rows, so this narrowed index
-- provides DB-level idempotency for the premium-grant flow without breaking purchase/comp.
CREATE UNIQUE INDEX ticket_one_premium_grant_per_user_event
  ON "Ticket" ("userId", "eventId")
  WHERE status = 'valid' AND source = 'premium_grant';
