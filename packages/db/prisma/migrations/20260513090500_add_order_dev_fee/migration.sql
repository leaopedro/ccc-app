-- Add Order dev-fee snapshot columns.
-- baseAmountCents + devFeeAmountCents + shippingCents == amountCents for new orders.
-- Legacy rows: baseAmountCents := amountCents - shippingCents, devFeeAmountCents := 0,
-- devFeePercent := 10 as a legacy default marker. Fees are not retroactively imputed.
--
-- Rollback path:
--   pnpm prisma migrate resolve --rolled-back 20260513090500_add_order_dev_fee
--   ALTER TABLE "Order" DROP COLUMN "devFeeAmountCents";
--   ALTER TABLE "Order" DROP COLUMN "devFeePercent";
--   ALTER TABLE "Order" DROP COLUMN "baseAmountCents";

ALTER TABLE "Order"
  ADD COLUMN "baseAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "devFeePercent" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "devFeeAmountCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "Order"
SET "baseAmountCents" = GREATEST("amountCents" - COALESCE("shippingCents", 0), 0);
