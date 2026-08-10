-- CreateEnum
CREATE TYPE "MonthlyBoxStatus" AS ENUM ('open', 'awaiting_payment', 'ready', 'skipped', 'cancelled');

-- AlterEnum
ALTER TYPE "OrderKind" ADD VALUE 'box';

-- CreateTable
CREATE TABLE "MonthlyBox" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "cycleKey" VARCHAR(10) NOT NULL,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "cycleEnd" TIMESTAMP(3) NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "status" "MonthlyBoxStatus" NOT NULL DEFAULT 'open',
    "budgetCentsSnapshot" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "itemsTotalCents" INTEGER NOT NULL DEFAULT 0,
    "partnersTotalCents" INTEGER NOT NULL DEFAULT 0,
    "overflowCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "chargeCents" INTEGER NOT NULL DEFAULT 0,
    "autoSendOptIn" BOOLEAN NOT NULL DEFAULT false,
    "shippingAddressId" TEXT,
    "orderId" TEXT,
    "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'unfulfilled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyBoxItem" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "titleSnapshot" VARCHAR(140) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "droppedAt" TIMESTAMP(3),
    "dropReason" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyBoxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyBoxPartnerItem" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "partnerModuleId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "nameSnapshot" VARCHAR(80) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "droppedAt" TIMESTAMP(3),
    "dropReason" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyBoxPartnerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoxCatalogItemCycleStock" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "cycleKey" VARCHAR(10) NOT NULL,
    "total" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoxCatalogItemCycleStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBox_orderId_key" ON "MonthlyBox"("orderId");

-- CreateIndex
CREATE INDEX "MonthlyBox_status_cutoffAt_idx" ON "MonthlyBox"("status", "cutoffAt");

-- CreateIndex
CREATE INDEX "MonthlyBox_cycleKey_fulfillmentStatus_idx" ON "MonthlyBox"("cycleKey", "fulfillmentStatus");

-- CreateIndex
CREATE INDEX "MonthlyBox_membershipId_idx" ON "MonthlyBox"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBox_membershipId_cycleKey_key" ON "MonthlyBox"("membershipId", "cycleKey");

-- CreateIndex
CREATE INDEX "MonthlyBoxItem_boxId_addedAt_idx" ON "MonthlyBoxItem"("boxId", "addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBoxItem_boxId_catalogItemId_key" ON "MonthlyBoxItem"("boxId", "catalogItemId");

-- CreateIndex
CREATE INDEX "MonthlyBoxPartnerItem_boxId_addedAt_idx" ON "MonthlyBoxPartnerItem"("boxId", "addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBoxPartnerItem_boxId_partnerModuleId_key" ON "MonthlyBoxPartnerItem"("boxId", "partnerModuleId");

-- CreateIndex
CREATE UNIQUE INDEX "BoxCatalogItemCycleStock_catalogItemId_cycleKey_key" ON "BoxCatalogItemCycleStock"("catalogItemId", "cycleKey");

-- AddForeignKey
ALTER TABLE "MonthlyBox" ADD CONSTRAINT "MonthlyBox_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "PremiumMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBox" ADD CONSTRAINT "MonthlyBox_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "ShippingAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBox" ADD CONSTRAINT "MonthlyBox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBoxItem" ADD CONSTRAINT "MonthlyBoxItem_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "MonthlyBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBoxItem" ADD CONSTRAINT "MonthlyBoxItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "BoxCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBoxPartnerItem" ADD CONSTRAINT "MonthlyBoxPartnerItem_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "MonthlyBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBoxPartnerItem" ADD CONSTRAINT "MonthlyBoxPartnerItem_partnerModuleId_fkey" FOREIGN KEY ("partnerModuleId") REFERENCES "PartnerModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoxCatalogItemCycleStock" ADD CONSTRAINT "BoxCatalogItemCycleStock_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "BoxCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
