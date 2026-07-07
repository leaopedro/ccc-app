-- CreateEnum
CREATE TYPE "NotificationDeliveryMode" AS ENUM ('in_app_only', 'in_app_plus_push');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "destination" JSONB;

-- AlterTable
ALTER TABLE "Broadcast"
  ADD COLUMN "deliveryMode" "NotificationDeliveryMode" NOT NULL DEFAULT 'in_app_plus_push',
  ADD COLUMN "destination" JSONB;

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
