-- Make maxTicketsPerUser nullable; null means unlimited tickets per user.
ALTER TABLE "Event" ALTER COLUMN "maxTicketsPerUser" DROP NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "maxTicketsPerUser" DROP DEFAULT;
