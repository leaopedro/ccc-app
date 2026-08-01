-- Rebrand JDM -> CCC for the badge catalog identifiers.
--
-- Scope:
--   1. Rename the `BadgeCategory` enum value 'jdm' -> 'ccc'. RENAME VALUE
--      rewrites every existing `Badge.category` cell in place, so no separate
--      data UPDATE is needed for the enum column.
--   2. Rename the three catalog codes 'JDM-00x' -> 'CCC-00x' in `Badge.code`.
--      `GarageBadge.badgeCode` is an FK to `Badge.code` with ON UPDATE CASCADE
--      (see GarageBadge_badgeCode_fkey), so earned-badge rows follow the code
--      change automatically inside this same transaction.
--
-- Display labels already read "CCC" in app copy; only the persisted
-- identifiers change here. Idempotency is not required (forward-only Prisma
-- migration applied once per environment).

-- 1. Enum value rename (rewrites Badge.category cells in place).
ALTER TYPE "BadgeCategory" RENAME VALUE 'jdm' TO 'ccc';

-- 2. Catalog code rename. FK cascade propagates to GarageBadge.badgeCode.
UPDATE "Badge" SET "code" = 'CCC-001' WHERE "code" = 'JDM-001';
UPDATE "Badge" SET "code" = 'CCC-002' WHERE "code" = 'JDM-002';
UPDATE "Badge" SET "code" = 'CCC-003' WHERE "code" = 'JDM-003';
