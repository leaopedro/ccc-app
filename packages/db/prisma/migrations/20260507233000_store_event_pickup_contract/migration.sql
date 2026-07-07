-- AlterTable
ALTER TABLE "StoreSettings"
    ADD COLUMN "eventPickupEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order"
    ADD COLUMN "pickupEventId" TEXT,
    ADD COLUMN "pickupTicketId" TEXT;

-- CreateIndex
CREATE INDEX "Order_pickupEventId_idx" ON "Order"("pickupEventId");

-- CreateIndex
CREATE INDEX "Order_pickupTicketId_idx" ON "Order"("pickupTicketId");
