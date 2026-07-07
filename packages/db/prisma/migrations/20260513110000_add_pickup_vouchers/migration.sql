-- CreateEnum
CREATE TYPE "PickupVoucherStatus" AS ENUM ('valid', 'used', 'revoked');

-- CreateTable
CREATE TABLE "PickupVoucher" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "ticketId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "variantId" TEXT,
    "code" VARCHAR(300) NOT NULL,
    "status" "PickupVoucherStatus" NOT NULL DEFAULT 'valid',
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PickupVoucher_code_key" ON "PickupVoucher"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PickupVoucher_orderItemId_unitIndex_key" ON "PickupVoucher"("orderItemId", "unitIndex");

-- CreateIndex
CREATE INDEX "PickupVoucher_orderId_idx" ON "PickupVoucher"("orderId");

-- CreateIndex
CREATE INDEX "PickupVoucher_ticketId_idx" ON "PickupVoucher"("ticketId");

-- CreateIndex
CREATE INDEX "PickupVoucher_eventId_status_idx" ON "PickupVoucher"("eventId", "status");

-- AddForeignKey
ALTER TABLE "PickupVoucher" ADD CONSTRAINT "PickupVoucher_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupVoucher" ADD CONSTRAINT "PickupVoucher_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupVoucher" ADD CONSTRAINT "PickupVoucher_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupVoucher" ADD CONSTRAINT "PickupVoucher_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupVoucher" ADD CONSTRAINT "PickupVoucher_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
