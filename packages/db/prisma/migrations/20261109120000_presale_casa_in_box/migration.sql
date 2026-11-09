-- CreateEnum
CREATE TYPE "OrderOrigin" AS ENUM ('app', 'casa_in_box');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutUrl" TEXT,
ADD COLUMN     "clientRequestId" VARCHAR(64),
ADD COLUMN     "confirmationEmailSentAt" TIMESTAMP(3),
ADD COLUMN     "origin" "OrderOrigin" NOT NULL DEFAULT 'app';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "visibleInPresale" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PresaleSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "shippingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "deliveryCepRanges" JSONB NOT NULL DEFAULT '[]',
    "deliveryAreaLabel" TEXT,
    "pickupAddress" TEXT,
    "pickupHours" TEXT,
    "firstBatchLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresaleSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresaleGuest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "recipientName" VARCHAR(140),
    "line1" VARCHAR(140),
    "number" VARCHAR(20),
    "district" VARCHAR(100),
    "city" VARCHAR(100),
    "stateCode" VARCHAR(2),
    "postalCode" VARCHAR(9),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresaleGuest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PresaleGuest_orderId_key" ON "PresaleGuest"("orderId");

-- CreateIndex
CREATE INDEX "PresaleGuest_email_idx" ON "PresaleGuest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_origin_clientRequestId_key" ON "Order"("origin", "clientRequestId");

-- CreateIndex
CREATE INDEX "Product_visibleInPresale_status_idx" ON "Product"("visibleInPresale", "status");

-- AddForeignKey
ALTER TABLE "PresaleGuest" ADD CONSTRAINT "PresaleGuest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

