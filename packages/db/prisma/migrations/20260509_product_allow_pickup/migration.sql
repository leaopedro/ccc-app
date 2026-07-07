-- Add allowPickup boolean to Product
-- Backfill: products with shippingFeeCents IS NULL were pickup-only under the old implicit model
ALTER TABLE "Product" ADD COLUMN "allowPickup" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Product" SET "allowPickup" = true WHERE "shippingFeeCents" IS NULL;
