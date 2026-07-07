-- Add allowShip boolean to Product
-- Backfill: on main, shippingFeeCents IS NULL means pickup-only (no shipping).
-- Only products with an explicit fee were shippable.
ALTER TABLE "Product" ADD COLUMN "allowShip" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Product" SET "allowShip" = true WHERE "shippingFeeCents" IS NOT NULL;
