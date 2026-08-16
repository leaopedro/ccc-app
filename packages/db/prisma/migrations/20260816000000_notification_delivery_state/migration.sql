-- Notification becomes a delivery outbox: sentAt IS NULL means "not yet
-- delivered". attemptCount/lastAttemptAt/failureCode let a worker retry
-- transient send failures instead of the row being marked sent on all-error.
ALTER TABLE "Notification" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "failureCode" VARCHAR(80);

-- Close the historical backlog before the delivery worker turns on: any
-- pre-existing row with a null sentAt (e.g. old zero-token notifications)
-- would otherwise be picked up and (re)delivered as a stale push.
UPDATE "Notification" SET "sentAt" = "createdAt" WHERE "sentAt" IS NULL;

CREATE INDEX "Notification_sentAt_attemptCount_idx" ON "Notification"("sentAt", "attemptCount");
