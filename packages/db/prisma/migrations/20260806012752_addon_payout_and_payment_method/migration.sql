-- AlterTable
ALTER TABLE "PremiumAddonModule" ADD COLUMN     "payoutAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorName" VARCHAR(120);

-- AlterTable
ALTER TABLE "PremiumMembership" ADD COLUMN     "paymentBrand" VARCHAR(20),
ADD COLUMN     "paymentLast4" VARCHAR(4);

-- AlterTable
ALTER TABLE "PremiumMembershipAddon" ADD COLUMN     "payoutAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorName" VARCHAR(120);
