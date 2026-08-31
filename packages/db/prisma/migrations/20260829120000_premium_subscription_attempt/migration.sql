-- CreateEnum
CREATE TYPE "PremiumSubscriptionAttemptStatus" AS ENUM ('pending', 'succeeded', 'abandoned', 'failed');

-- CreateTable
CREATE TABLE "PremiumSubscriptionAttempt" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "cadence" "PremiumCadence" NOT NULL,
    "planTier" "GaragePremiumTier" NOT NULL,
    "packageDigest" VARCHAR(24) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "providerSubRef" VARCHAR(120),
    "status" "PremiumSubscriptionAttemptStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumSubscriptionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PremiumSubscriptionAttempt_status_createdAt_idx" ON "PremiumSubscriptionAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PremiumSubscriptionAttempt_garageId_status_idx" ON "PremiumSubscriptionAttempt"("garageId", "status");

-- CreateIndex
CREATE INDEX "PremiumSubscriptionAttempt_providerSubRef_idx" ON "PremiumSubscriptionAttempt"("providerSubRef");

-- AddForeignKey
ALTER TABLE "PremiumSubscriptionAttempt" ADD CONSTRAINT "PremiumSubscriptionAttempt_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma tentativa pendente por garagem. Parcial de proposito: recontratar depois
-- de cancelar precisa abrir uma tentativa nova, e uma unique total sobre
-- garageId bloquearia isso para sempre.
-- Prisma nao suporta indice unico parcial nativamente; mesmo padrao de
-- Cart_userId_open_unique (20260504184500).
CREATE UNIQUE INDEX "PremiumSubscriptionAttempt_garageId_pending_unique"
  ON "PremiumSubscriptionAttempt" ("garageId")
  WHERE "status" = 'pending';
