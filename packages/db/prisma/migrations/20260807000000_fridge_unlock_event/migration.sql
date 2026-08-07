-- CreateEnum
CREATE TYPE "FridgeUnlockStatus" AS ENUM ('sent', 'failed_offline');

-- CreateTable
CREATE TABLE "FridgeUnlockEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "FridgeUnlockStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FridgeUnlockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FridgeUnlockEvent_deviceId_createdAt_idx" ON "FridgeUnlockEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "FridgeUnlockEvent_userId_idx" ON "FridgeUnlockEvent"("userId");

-- AddForeignKey
ALTER TABLE "FridgeUnlockEvent" ADD CONSTRAINT "FridgeUnlockEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
