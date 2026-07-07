-- CreateEnum
CREATE TYPE "FeedAccess" AS ENUM ('public', 'attendees', 'members_only');

-- CreateEnum
CREATE TYPE "PostingAccess" AS ENUM ('attendees', 'members_only', 'organizers_only');

-- CreateEnum
CREATE TYPE "FeedPostStatus" AS ENUM ('visible', 'hidden', 'removed');

-- CreateEnum
CREATE TYPE "FeedCommentStatus" AS ENUM ('visible', 'hidden', 'removed');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "ReportTargetKind" AS ENUM ('post', 'comment');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "feedAccess" "FeedAccess" NOT NULL DEFAULT 'attendees',
ADD COLUMN     "feedEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxPhotosPerUser" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "maxPostsPerUser" INTEGER,
ADD COLUMN     "postingAccess" "PostingAccess" NOT NULL DEFAULT 'attendees';

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "carId" TEXT,
    "authorUserId" TEXT,
    "body" VARCHAR(2000) NOT NULL,
    "status" "FeedPostStatus" NOT NULL DEFAULT 'visible',
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPostPhoto" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "objectKey" VARCHAR(300) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedPostPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" VARCHAR(1000) NOT NULL,
    "status" "FeedCommentStatus" NOT NULL DEFAULT 'visible',
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedReaction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'like',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "targetKind" "ReportTargetKind" NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "reporterUserId" TEXT,
    "reason" VARCHAR(300) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "resolverId" TEXT,
    "resolution" VARCHAR(300),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedPost_eventId_createdAt_idx" ON "FeedPost"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FeedPost_carId_idx" ON "FeedPost"("carId");

-- CreateIndex
CREATE INDEX "FeedPost_authorUserId_idx" ON "FeedPost"("authorUserId");

-- CreateIndex
CREATE INDEX "FeedPost_status_createdAt_idx" ON "FeedPost"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPostPhoto_postId_sortOrder_idx" ON "FeedPostPhoto"("postId", "sortOrder");

-- CreateIndex
CREATE INDEX "FeedComment_postId_createdAt_idx" ON "FeedComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedComment_authorUserId_idx" ON "FeedComment"("authorUserId");

-- CreateIndex
CREATE INDEX "FeedComment_status_createdAt_idx" ON "FeedComment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedReaction_postId_idx" ON "FeedReaction"("postId");

-- CreateIndex
CREATE INDEX "FeedReaction_userId_idx" ON "FeedReaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedReaction_postId_userId_key" ON "FeedReaction"("postId", "userId");

-- CreateIndex
CREATE INDEX "Report_eventId_status_createdAt_idx" ON "Report"("eventId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Report_postId_idx" ON "Report"("postId");

-- CreateIndex
CREATE INDEX "Report_commentId_idx" ON "Report"("commentId");

-- CreateIndex
CREATE INDEX "Report_reporterUserId_idx" ON "Report"("reporterUserId");

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostPhoto" ADD CONSTRAINT "FeedPostPhoto_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReaction" ADD CONSTRAINT "FeedReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReaction" ADD CONSTRAINT "FeedReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: enforce exactly one of post / comment matches targetKind
ALTER TABLE "Report"
  ADD CONSTRAINT "Report_target_exactly_one"
  CHECK (
    ("targetKind" = 'post'    AND "postId" IS NOT NULL AND "commentId" IS NULL)
    OR
    ("targetKind" = 'comment' AND "commentId" IS NOT NULL AND "postId" IS NULL)
  );
