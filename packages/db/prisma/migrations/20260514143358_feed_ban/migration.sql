-- CreateEnum
CREATE TYPE "BanScope" AS ENUM ('view', 'post');

-- CreateTable
CREATE TABLE "FeedBan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "BanScope" NOT NULL,
    "reason" VARCHAR(300),
    "bannedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedBan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedBan_eventId_idx" ON "FeedBan"("eventId");

-- CreateIndex
CREATE INDEX "FeedBan_userId_idx" ON "FeedBan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedBan_eventId_userId_scope_key" ON "FeedBan"("eventId", "userId", "scope");

-- AddForeignKey
ALTER TABLE "FeedBan" ADD CONSTRAINT "FeedBan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedBan" ADD CONSTRAINT "FeedBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedBan" ADD CONSTRAINT "FeedBan_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
