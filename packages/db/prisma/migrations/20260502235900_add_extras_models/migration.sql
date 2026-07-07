-- CreateEnum
CREATE TYPE "TicketExtraItemStatus" AS ENUM ('valid', 'used', 'revoked');

-- CreateTable
CREATE TABLE "TicketExtra" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "quantityTotal" INTEGER NOT NULL,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderExtra" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "extraId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderExtra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketExtraItem" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "extraId" TEXT NOT NULL,
    "code" VARCHAR(300) NOT NULL,
    "status" "TicketExtraItemStatus" NOT NULL DEFAULT 'valid',
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketExtraItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketExtra_eventId_sortOrder_idx" ON "TicketExtra"("eventId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OrderExtra_orderId_extraId_key" ON "OrderExtra"("orderId", "extraId");

-- CreateIndex
CREATE INDEX "OrderExtra_orderId_idx" ON "OrderExtra"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketExtraItem_code_key" ON "TicketExtraItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TicketExtraItem_ticketId_extraId_key" ON "TicketExtraItem"("ticketId", "extraId");

-- CreateIndex
CREATE INDEX "TicketExtraItem_ticketId_idx" ON "TicketExtraItem"("ticketId");

-- AddForeignKey
ALTER TABLE "TicketExtra" ADD CONSTRAINT "TicketExtra_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderExtra" ADD CONSTRAINT "OrderExtra_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderExtra" ADD CONSTRAINT "OrderExtra_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "TicketExtra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketExtraItem" ADD CONSTRAINT "TicketExtraItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketExtraItem" ADD CONSTRAINT "TicketExtraItem_extraId_fkey" FOREIGN KEY ("extraId") REFERENCES "TicketExtra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
