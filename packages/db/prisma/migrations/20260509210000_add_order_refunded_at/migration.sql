-- AlterTable
ALTER TABLE "Order" ADD COLUMN "refundedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_status_refundedAt_idx" ON "Order"("status", "refundedAt");

-- Backfill: set refundedAt for existing refunded orders.
-- updatedAt is the best approximation: it reflects when the row last changed,
-- which for refunded orders is when the webhook handler set status='refunded'.
UPDATE "Order"
SET "refundedAt" = "updatedAt"
WHERE "status" = 'refunded'
  AND "refundedAt" IS NULL;
