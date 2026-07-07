-- CreateEnum
CREATE TYPE "XpReason" AS ENUM ('event_checkin', 'car_create', 'post_create', 'post_like', 'badge_award', 'premium_activation', 'admin_adjustment');

-- AlterTable
ALTER TABLE "Garage" ADD COLUMN     "likesReceived" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "XpEvent" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "XpReason" NOT NULL,
    "sourceRef" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XpEvent_garageId_createdAt_idx" ON "XpEvent"("garageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpEvent_garageId_reason_sourceRef_key" ON "XpEvent"("garageId", "reason", "sourceRef");

-- AddForeignKey
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
