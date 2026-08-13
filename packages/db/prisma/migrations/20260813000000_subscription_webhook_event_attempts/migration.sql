-- Count redeliveries that hit the unprocessed-replay branch so a
-- deterministically failing event escalates instead of silently expiring after
-- Stripe stops retrying (~3 days).
ALTER TABLE "SubscriptionWebhookEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
