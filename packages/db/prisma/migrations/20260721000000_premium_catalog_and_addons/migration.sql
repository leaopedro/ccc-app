-- CreateEnum
CREATE TYPE "PremiumAddonUnit" AS ENUM ('access', 'hours');

-- CreateEnum
CREATE TYPE "PremiumAddonStatus" AS ENUM ('active', 'cancel_scheduled', 'cancelled');

-- AlterTable
ALTER TABLE "PremiumMembership" ADD COLUMN     "addonsAmountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PremiumMembershipInvoice" ADD COLUMN     "addonsAmountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PremiumPlan" (
    "id" TEXT NOT NULL,
    "tier" "GaragePremiumTier" NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumPlanPrice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cadence" "PremiumCadence" NOT NULL,
    "baseAmountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "stripePriceId" VARCHAR(120),
    "rcProductId" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumPlanPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumPlanBenefit" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "label" VARCHAR(140) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumPlanBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumAddonModule" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "monthlyDeltaCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "quotaPerCycle" INTEGER NOT NULL,
    "quotaUnit" "PremiumAddonUnit" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stripePriceId" VARCHAR(120),
    "rcProductId" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumAddonModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumMembershipAddon" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "addonKey" VARCHAR(40) NOT NULL,
    "status" "PremiumAddonStatus" NOT NULL DEFAULT 'active',
    "providerItemRef" VARCHAR(200),
    "monthlyDeltaCents" INTEGER NOT NULL,
    "quotaPerCycle" INTEGER NOT NULL,
    "quotaUnit" "PremiumAddonUnit" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumMembershipAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumAddonUsage" (
    "id" TEXT NOT NULL,
    "membershipAddonId" TEXT NOT NULL,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "cycleEnd" TIMESTAMP(3) NOT NULL,
    "quotaTotal" INTEGER NOT NULL,
    "quotaUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumAddonUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumAddonRedemption" (
    "id" TEXT NOT NULL,
    "usageId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "redeemedByUserId" TEXT,
    "note" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumAddonRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PremiumPlan_tier_key" ON "PremiumPlan"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumPlan_slug_key" ON "PremiumPlan"("slug");

-- CreateIndex
CREATE INDEX "PremiumPlan_active_sortOrder_idx" ON "PremiumPlan"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumPlanPrice_planId_cadence_key" ON "PremiumPlanPrice"("planId", "cadence");

-- CreateIndex
CREATE INDEX "PremiumPlanBenefit_planId_sortOrder_idx" ON "PremiumPlanBenefit"("planId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumAddonModule_key_key" ON "PremiumAddonModule"("key");

-- CreateIndex
CREATE INDEX "PremiumAddonModule_active_sortOrder_idx" ON "PremiumAddonModule"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "PremiumMembershipAddon_membershipId_status_idx" ON "PremiumMembershipAddon"("membershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumMembershipAddon_membershipId_addonKey_key" ON "PremiumMembershipAddon"("membershipId", "addonKey");

-- CreateIndex
CREATE INDEX "PremiumAddonUsage_membershipAddonId_cycleEnd_idx" ON "PremiumAddonUsage"("membershipAddonId", "cycleEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumAddonUsage_membershipAddonId_cycleStart_key" ON "PremiumAddonUsage"("membershipAddonId", "cycleStart");

-- CreateIndex
CREATE INDEX "PremiumAddonRedemption_usageId_idx" ON "PremiumAddonRedemption"("usageId");

-- AddForeignKey
ALTER TABLE "PremiumPlanPrice" ADD CONSTRAINT "PremiumPlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PremiumPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumPlanBenefit" ADD CONSTRAINT "PremiumPlanBenefit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PremiumPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumMembershipAddon" ADD CONSTRAINT "PremiumMembershipAddon_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "PremiumMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumMembershipAddon" ADD CONSTRAINT "PremiumMembershipAddon_addonKey_fkey" FOREIGN KEY ("addonKey") REFERENCES "PremiumAddonModule"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumAddonUsage" ADD CONSTRAINT "PremiumAddonUsage_membershipAddonId_fkey" FOREIGN KEY ("membershipAddonId") REFERENCES "PremiumMembershipAddon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumAddonRedemption" ADD CONSTRAINT "PremiumAddonRedemption_usageId_fkey" FOREIGN KEY ("usageId") REFERENCES "PremiumAddonUsage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
