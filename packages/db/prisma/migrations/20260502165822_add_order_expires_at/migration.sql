-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_tierId_status_expiresAt_idx" ON "Order"("tierId", "status", "expiresAt");
