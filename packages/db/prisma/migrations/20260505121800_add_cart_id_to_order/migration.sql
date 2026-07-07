-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cartId" TEXT;

-- CreateIndex
CREATE INDEX "Order_cartId_idx" ON "Order"("cartId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
