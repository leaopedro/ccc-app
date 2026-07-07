-- Garage per-user pivot: introduce Garage model and drop Car.description.
-- See docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md §5.2.

-- ── 1. Premium tier enum + Garage table ───────────────────────────────────
CREATE TYPE "GaragePremiumTier" AS ENUM ('bronze', 'silver', 'gold');

CREATE TABLE "Garage" (
  "id"           TEXT                NOT NULL,
  "userId"       TEXT                NOT NULL,
  "name"         VARCHAR(50)         NOT NULL,
  "slug"         VARCHAR(40)         NOT NULL,
  "description"  VARCHAR(500),
  "isPublic"     BOOLEAN             NOT NULL DEFAULT FALSE,
  "premiumTier"  "GaragePremiumTier",
  "premiumUntil" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)        NOT NULL,
  CONSTRAINT "Garage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Garage_userId_key" ON "Garage"("userId");
CREATE UNIQUE INDEX "Garage_slug_key"   ON "Garage"("slug");
CREATE        INDEX "Garage_slug_idx"   ON "Garage"("slug");
CREATE        INDEX "Garage_premiumTier_premiumUntil_idx"
  ON "Garage"("premiumTier", "premiumUntil");

ALTER TABLE "Garage"
  ADD CONSTRAINT "Garage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Backfill one Garage row per existing User ─────────────────────────
-- Neutral defaults only — no derivation from User.name (LGPD).
-- name = 'Garagem', slug = 'user-<id8>', isPublic = FALSE (column default).
-- The slug DO-loop covers astronomically-unlikely id-prefix collisions.
DO $$
DECLARE
  u RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
  created_count INT := 0;
BEGIN
  FOR u IN SELECT "id" FROM "User" ORDER BY "createdAt" ASC LOOP
    -- Skip if a Garage row already exists for this user (idempotent re-run).
    IF EXISTS (SELECT 1 FROM "Garage" WHERE "userId" = u."id") THEN
      CONTINUE;
    END IF;

    base := 'user-' || SUBSTR(u."id", 1, 8);
    candidate := base;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM "Garage" WHERE "slug" = candidate) LOOP
      candidate := base || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;

    INSERT INTO "Garage" ("id", "userId", "name", "slug", "createdAt", "updatedAt")
    VALUES (
      'g_bf_' || u."id",
      u."id",
      'Garagem',
      candidate,
      NOW(),
      NOW()
    )
    ON CONFLICT ("userId") DO NOTHING;

    created_count := created_count + 1;
  END LOOP;

  -- Audit action 'garage.backfill' is added to adminAuditActionSchema in
  -- packages/shared/src/admin.ts in this PR.
  INSERT INTO "AdminAudit" ("id", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
  VALUES (
    'audit_garage_backfill_20260521120300',
    'system',
    'garage.backfill',
    'general_settings',
    'general_default',
    jsonb_build_object('garagesCreated', created_count),
    NOW()
  )
  ON CONFLICT ("id") DO NOTHING;
END $$;

-- ── 3. Drop Car.description ──────────────────────────────────────────────
-- Shipped in PR #356, few days old. Garage.description is now the canonical
-- owner bio surface. Rollback note in spec §5.4.
ALTER TABLE "Car" DROP COLUMN "description";
