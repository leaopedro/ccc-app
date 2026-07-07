-- AlterTable
ALTER TABLE "OrderItem"
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "tickets" JSONB;

-- CreateIndex
CREATE INDEX "OrderItem_eventId_idx" ON "OrderItem"("eventId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
