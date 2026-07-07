-- DropIndex
DROP INDEX "Ticket_orderId_key";

-- CreateIndex
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");
