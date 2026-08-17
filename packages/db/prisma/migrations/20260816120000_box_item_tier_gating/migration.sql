-- CreateEnum
CREATE TYPE "BoxItemRestrictedDisplay" AS ENUM ('locked', 'hidden');

-- AlterTable
ALTER TABLE "BoxCatalogItem" ADD COLUMN "minTier" "GaragePremiumTier";
ALTER TABLE "BoxCatalogItem" ADD COLUMN "restrictedDisplay" "BoxItemRestrictedDisplay" NOT NULL DEFAULT 'locked';
