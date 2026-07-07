-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "maxTicketsPerUser" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;
