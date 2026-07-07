-- Drop per-spot tier model in favor of Garage-level premium membership.
-- Free vs extra is now derived from GarageSpot.source.
-- See docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md §5.1.

DROP INDEX IF EXISTS "GarageSpot_userId_tier_idx";
ALTER TABLE "GarageSpot" DROP COLUMN "tier";
DROP TYPE "GarageSpotTier";
