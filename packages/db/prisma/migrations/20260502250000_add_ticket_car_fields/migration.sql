-- AlterTable: add optional carId and licensePlate to Ticket
ALTER TABLE "Ticket" ADD COLUMN "carId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "licensePlate" VARCHAR(20);

-- AddForeignKey: Ticket.carId -> Car.id (SetNull on delete)
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: Ticket.carId for car-based queries
CREATE INDEX "Ticket_carId_idx" ON "Ticket"("carId");
