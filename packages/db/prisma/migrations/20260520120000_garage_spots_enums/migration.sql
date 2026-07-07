-- AlterEnum (must commit before referencing new values in constraints)
CREATE TYPE "GarageSpotTier"   AS ENUM ('free', 'extra', 'premium');
CREATE TYPE "GarageSpotSource" AS ENUM ('default_free', 'purchase', 'admin_grant', 'premium_membership');
ALTER TYPE "FulfillmentMethod" ADD VALUE 'virtual';
ALTER TYPE "FulfillmentStatus" ADD VALUE 'virtual_complete';
