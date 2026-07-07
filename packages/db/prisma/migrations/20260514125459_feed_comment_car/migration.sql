-- AlterTable
ALTER TABLE "FeedComment" ADD COLUMN     "carId" TEXT;

-- CreateIndex
CREATE INDEX "FeedComment_carId_idx" ON "FeedComment"("carId");

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;
