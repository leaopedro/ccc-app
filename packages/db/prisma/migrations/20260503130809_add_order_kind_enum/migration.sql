-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('ticket', 'extras_only');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "kind" "OrderKind" NOT NULL DEFAULT 'ticket';
