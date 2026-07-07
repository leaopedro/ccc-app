-- CreateEnum
CREATE TYPE "BadgeCategory" AS ENUM ('eventos', 'carros', 'comunidade', 'jdm');

-- CreateEnum
CREATE TYPE "BadgeRarity" AS ENUM ('common', 'rare', 'legendary');

-- AlterTable
ALTER TABLE "GeneralSettings" ADD COLUMN     "gamificationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "category" "BadgeCategory" NOT NULL,
    "rarity" "BadgeRarity" NOT NULL,
    "premiumExclusive" BOOLEAN NOT NULL DEFAULT false,
    "icon" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarageBadge" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "badgeCode" VARCHAR(20) NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "sourceRef" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarageBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Badge_code_key" ON "Badge"("code");

-- CreateIndex
CREATE INDEX "GarageBadge_garageId_pinned_idx" ON "GarageBadge"("garageId", "pinned");

-- CreateIndex
CREATE INDEX "GarageBadge_garageId_pinnedAt_idx" ON "GarageBadge"("garageId", "pinnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GarageBadge_garageId_badgeCode_key" ON "GarageBadge"("garageId", "badgeCode");

-- AddForeignKey
ALTER TABLE "GarageBadge" ADD CONSTRAINT "GarageBadge_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarageBadge" ADD CONSTRAINT "GarageBadge_badgeCode_fkey" FOREIGN KEY ("badgeCode") REFERENCES "Badge"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
