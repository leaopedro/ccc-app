-- AlterTable
ALTER TABLE "TicketExtra" ALTER COLUMN "quantityTotal" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TicketExtra" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
