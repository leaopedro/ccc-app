-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "livemode" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PremiumMembershipInvoice" ADD COLUMN     "livemode" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Order_livemode_status_paidAt_idx" ON "Order"("livemode", "status", "paidAt");

-- CreateIndex
CREATE INDEX "PremiumMembershipInvoice_livemode_paidAt_idx" ON "PremiumMembershipInvoice"("livemode", "paidAt");
