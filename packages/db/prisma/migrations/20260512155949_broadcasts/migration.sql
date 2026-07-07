-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('draft', 'scheduled', 'processing', 'sent', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "BroadcastTargetKind" AS ENUM ('all', 'premium', 'attendees_of_event', 'city');

-- CreateEnum
CREATE TYPE "BroadcastDeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pushPrefs" JSONB NOT NULL DEFAULT '{"transactional":true,"marketing":true}';

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "targetKind" "BroadcastTargetKind" NOT NULL,
    "targetValue" VARCHAR(200),
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "BroadcastStatus" NOT NULL DEFAULT 'draft',
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastDelivery" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" VARCHAR(200),
    "status" "BroadcastDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureCode" VARCHAR(80),
    "failureMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_status_scheduledAt_idx" ON "Broadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Broadcast_createdAt_idx" ON "Broadcast"("createdAt");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_broadcastId_status_idx" ON "BroadcastDelivery"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_userId_idx" ON "BroadcastDelivery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastDelivery_broadcastId_userId_key" ON "BroadcastDelivery"("broadcastId", "userId");

-- AddForeignKey
ALTER TABLE "BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
