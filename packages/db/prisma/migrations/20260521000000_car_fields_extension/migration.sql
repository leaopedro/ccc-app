-- Migration: 20260521000000_car_fields_extension
-- Adds description, modifications, tightens nickname to required+unique+20chars.
-- All DDL + backfill run in one implicit transaction (Prisma wraps each migration).

-- Step 1: add new nullable columns (nullable so existing rows do not violate NOT NULL yet)
ALTER TABLE "Car" ADD COLUMN IF NOT EXISTS "description"   VARCHAR(150);
ALTER TABLE "Car" ADD COLUMN IF NOT EXISTS "modifications" TEXT[]        NOT NULL DEFAULT '{}';

-- Step 2: defensively truncate any pre-existing nickname > 20 chars before the type change.
-- The old column was VARCHAR(60); production data may have values longer than 20 chars.
-- We apply the same dedupe strategy as the NULL backfill below.
WITH long_nicks AS (
  SELECT
    id,
    SUBSTR(nickname, 1, 20) AS base_nick,
    ROW_NUMBER() OVER (
      PARTITION BY SUBSTR(nickname, 1, 20)
      ORDER BY "createdAt", id
    ) AS rn
  FROM "Car"
  WHERE nickname IS NOT NULL AND LENGTH(nickname) > 20
),
computed_long AS (
  SELECT
    id,
    CASE
      WHEN rn = 1 THEN base_nick
      ELSE SUBSTR(base_nick, 1, 20 - LENGTH(' ' || rn::TEXT)) || ' ' || rn::TEXT
    END AS new_nick
  FROM long_nicks
)
UPDATE "Car" c
SET nickname = comp.new_nick
FROM computed_long comp
WHERE c.id = comp.id;

-- Step 3: backfill nickname for every row that currently has a NULL nickname
-- and deduplicate using ROW_NUMBER partitioned by candidate nickname.
-- Algorithm:
--   base = SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20)  -- truncate to 20
--   rn   = ROW_NUMBER() OVER (PARTITION BY base ORDER BY "createdAt")
--   if rn == 1 -> use base as-is
--   if rn >= 2 -> append ' ' + rn, re-truncate to 20 chars
--
-- Note: rows where nickname is already set are left untouched.
-- Note: INITCAP is Postgres built-in; safe to use here.

WITH ranked AS (
  SELECT
    id,
    SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20) AS base_nick,
    ROW_NUMBER() OVER (
      PARTITION BY SUBSTR(INITCAP(make) || ' ' || INITCAP(model), 1, 20)
      ORDER BY "createdAt", id
    ) AS rn
  FROM "Car"
  WHERE nickname IS NULL
),
computed AS (
  SELECT
    id,
    CASE
      WHEN rn = 1 THEN base_nick
      ELSE SUBSTR(base_nick, 1, 20 - LENGTH(' ' || rn::TEXT)) || ' ' || rn::TEXT
    END AS new_nick
  FROM ranked
)
UPDATE "Car" c
SET nickname = comp.new_nick
FROM computed comp
WHERE c.id = comp.id;

-- Step 4: now that all rows have a nickname, enforce NOT NULL
ALTER TABLE "Car" ALTER COLUMN "nickname" SET NOT NULL;

-- Step 5: shrink the column to VARCHAR(20).
-- Any value longer than 20 would fail here. Step 2 ensures truncation above.
ALTER TABLE "Car" ALTER COLUMN "nickname" TYPE VARCHAR(20);

-- Step 6: add the global unique index on nickname.
CREATE UNIQUE INDEX IF NOT EXISTS "Car_nickname_key" ON "Car"("nickname");
