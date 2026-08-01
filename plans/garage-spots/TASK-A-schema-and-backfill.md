# Garage Spots — TASK-A: Schema, Virtual Product, Seed, Backfill

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20)
>
> **TASK-A is MERGED at `d6b50e4`.** The post-pivot delta lives in [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
>
> **Superseded by pivot:**
>
> - `GarageSpotTier` enum + `GarageSpot.tier` column — dropped in pivot migration `20260520120200_drop_garage_spot_tier`.
> - Implicit assumption that `carSchema.tier` would tighten in TASK-B — never happens; the field never lands.
>
> **Still valid as shipped:**
>
> - `GarageSpot` table, `GarageSpotSource` enum (now the single signal for free vs extra).
> - `Product.virtual` + `Product.visibleInStore` columns, indexes, and the singleton garage Product seed.
> - `GeneralSettings.defaultFreeGarageSpots` semantics, including the rollout-NULL → 1 coercion from PR #355 fix `3abb6af`.
> - AdminAudit `general_settings.garage_backfill` action.
> - `visibleInStore` filtering on `/store/product-types` and `/store/products[/:slug]`.
>
> **Implementers of follow-up tasks:** do NOT replay any TASK-A migration. Read the spec for the new schema delta, then read this file for context on what already shipped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data substrate for Garage Spots — schema, enums, virtual-product flags, singleton seed, AdminAudit extensions, shared Zod schemas, and a transactional migration backfill of `GarageSpot` rows for every existing `Car` and every existing user — so downstream tasks (B–H) can be built against a live, idempotent foundation.

**Architecture:** One additive Prisma migration introduces the `GarageSpot` table, two new enums, three new columns on existing tables, and two enum-value additions. The migration's `migration.sql` carries an in-SQL backfill that runs in the same transaction Prisma wraps around it. The Prisma seed gains an idempotent block that creates a `garage_spot` `ProductType`, a singleton `Product` (virtual, hidden-from-store), and a single `Variant`. New Zod schemas in `packages/shared` describe enums and tier on the public `carSchema`, and extend `adminAuditActionSchema` + `recordAudit` entity-type union. No new endpoints. No settlement code changes. No UI.

**Tech Stack:** Prisma 6 + PostgreSQL 16 (additive migration with raw-SQL `DO` block for backfill), `@ccc/db` Prisma seed (`tsx prisma/seed.ts`), `@ccc/shared` Zod 3 schemas, Vitest + Testcontainers for integration tests against a real Postgres (per `apps/api/test/global-setup.ts`).

**Branch:** `feat/jdma-garage-task-a` off fresh `main`. Branch safety preflight from `CLAUDE.md` applies — confirm `git branch --show-current` is NOT `production` before the first edit.

---

## Scope summary

In scope (this task only):

- Prisma schema additions: `GarageSpot`, `GarageSpotTier`, `GarageSpotSource`, `Product.virtual`, `Product.visibleInStore`, `GeneralSettings.defaultFreeGarageSpots`, enum value `FulfillmentMethod.virtual`, enum value `FulfillmentStatus.virtual_complete`.
- Migration SQL: enum creates, column adds, table create, indexes, FKs, backfill `DO`-block.
- Seed extension: idempotent `garage_spot` ProductType + singleton garage `Product` + singleton `Variant`. Refuses to duplicate.
- Internal-product validation helper used by seed and by future admin paths (TASK-H): pure function `assertVirtualSingletonProtected(product)`.
- Shared Zod schemas: `garageSpotTierSchema`, `garageSpotSourceSchema`, extend `carSchema` with `tier`, `adminAuditActionSchema` literals, `adminCarUpdateSchema` (admin-only car fields).
- Extend `recordAudit` entityType union with `car`, `garage_spot`.
- Tests: shared Zod unit tests; API integration tests against real Postgres covering backfill correctness, migration idempotency, virtual-product seed idempotency, and FK behaviour on `Car` delete.

Explicitly out of scope (other tasks own these — do not touch in this branch):

- `GET /me/garage`, `POST /me/garage/spots/cart`, allocation tx → **TASK-B**.
- Virtual-product cart/checkout/settlement wiring → **TASK-C**. We add the enum values, we do **not** wire them into `settle.ts`.
- Mobile + admin UI → **TASK-D / TASK-E / TASK-F / TASK-G / TASK-H**.
- Reconcile fanout on settings save → **TASK-F**.

---

## Downstream unblock map

These artifacts gate other tasks. They MUST land first inside this branch:

| Artifact merged on `main`                                                  | Unblocks                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GarageSpot` table + enums + backfill migration                            | TASK-B (limit enforcement), TASK-G (admin spot delete), TASK-C (settlement creates `GarageSpot` rows for paid orders)                                                                                                                                                                                              |
| `Product.virtual`, `Product.visibleInStore` columns                        | TASK-C (checkout fork), TASK-H (admin product editor UI)                                                                                                                                                                                                                                                           |
| `FulfillmentMethod=virtual`, `FulfillmentStatus=virtual_complete` enum DDL | TASK-C (settlement assigns these on virtual orders). Note: TASK-C also owns extending the Zod schemas `fulfillmentStatusSchema` (packages/shared/src/orders.ts) and `adminFulfillmentMethodSchema` (packages/shared/src/admin.ts) to include these values. The enum DDL alone is not enough; see cross-task risks. |
| `GeneralSettings.defaultFreeGarageSpots` column                            | TASK-F (admin general-settings field)                                                                                                                                                                                                                                                                              |
| Seeded singleton garage Product + Variant                                  | TASK-B (`purchaseOption` resolver), TASK-C (settlement detects garage product), TASK-D (mobile buy card)                                                                                                                                                                                                           |
| `adminAuditActionSchema` literals + `recordAudit` entityType union         | TASK-G (admin emits these actions)                                                                                                                                                                                                                                                                                 |
| `carSchema.tier` as `.optional()`                                          | TASK-B (populates tier in `serializeCar`, then tightens to required)                                                                                                                                                                                                                                               |
| `carSchema.tier` required (tightened by TASK-B)                            | TASK-E (PremiumBadge + tier picker UI can rely on tier always being present)                                                                                                                                                                                                                                       |
| `adminCarUpdateSchema`                                                     | TASK-G (admin user-detail garage panel)                                                                                                                                                                                                                                                                            |

---

## File structure

```
packages/db/prisma/
  schema.prisma                                                  modify
  migrations/20260520120000_garage_spots_enums/migration.sql     create
  migrations/20260520120100_garage_spots_tables/migration.sql    create
  seed.ts                                                        modify

packages/db/src/
  garage-spot-product.ts                                         create     (singleton ids + guard)
  index.ts                                                       modify     (re-export guard)

packages/shared/src/
  garage.ts                                                      create     (tier, source, helpers)
  cars.ts                                                        modify     (extend carSchema with tier)
  admin.ts                                                       modify     (audit action enum, adminCarUpdateSchema)
  index.ts                                                       modify     (re-export garage)

packages/shared/
  package.json                                                   modify     (./garage export entry)

apps/api/src/services/
  admin-audit.ts                                                 modify     (entityType union: + car, garage_spot)

apps/api/test/services/
  garage-spot-singleton.test.ts                                  create
apps/api/test/migrations/
  garage-spot-backfill.test.ts                                   create
packages/shared/src/__tests__/
  garage.test.ts                                                 create
```

The new `packages/db/src/garage-spot-product.ts` keeps the singleton identifiers and the "do not delete / do not duplicate" guard in `@ccc/db` so both the seed (which lives in `@ccc/db`) and future admin code (TASK-H, in `apps/api`) can import the same source of truth. `apps/api/src/services` does NOT get a new file in this task.

---

## File-by-file changes

### 1. `packages/db/prisma/schema.prisma`

**Modify enum `FulfillmentMethod` (currently lines 393–396):**

```prisma
enum FulfillmentMethod {
  ship
  pickup
  virtual
}
```

**Modify enum `FulfillmentStatus` (currently lines 398–406):**

```prisma
enum FulfillmentStatus {
  unfulfilled
  packed
  shipped
  delivered
  pickup_ready
  picked_up
  cancelled
  virtual_complete
}
```

**Add new enums above the existing `model Car` (insert after line 178, before `model Car`):**

```prisma
enum GarageSpotTier {
  free
  extra
  premium
}

enum GarageSpotSource {
  default_free
  purchase
  admin_grant
  premium_membership
}
```

**Modify `model Car` (currently lines 180–198): add `spot` back-relation.**

```prisma
model Car {
  id        String   @id @default(cuid())
  userId    String
  make      String   @db.VarChar(60)
  model     String   @db.VarChar(60)
  year      Int
  nickname  String?  @db.VarChar(60)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  photos       CarPhoto[]
  tickets      Ticket[]
  feedPosts    FeedPost[]
  feedComments FeedComment[]
  spot         GarageSpot?   @relation("CarSpot")

  @@index([userId])
}
```

**Add `GarageSpot` model immediately after `model CarPhoto` block (after line 214):**

```prisma
model GarageSpot {
  id                String           @id @default(cuid())
  userId            String
  tier              GarageSpotTier   @default(free)
  source            GarageSpotSource
  carId             String?          @unique
  sourceOrderItemId String?          @unique
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  car  Car?  @relation("CarSpot", fields: [carId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([userId, tier])
  @@index([userId, carId])
}
```

**Modify `model User` (line 33+): add the `garageSpots` back-relation in the relations block (alongside `cars`).**

Insert this line near the other relations (after `cars` on line 61):

```prisma
  garageSpots         GarageSpot[]
```

**Modify `model Product` (currently lines 423–445): add two columns.**

```prisma
model Product {
  id               String        @id @default(cuid())
  slug             String        @unique @db.VarChar(140)
  title            String        @db.VarChar(140)
  description      String        @db.Text
  productTypeId    String
  basePriceCents   Int
  currency         String        @default("BRL") @db.VarChar(3)
  status           ProductStatus @default(draft)
  allowPickup      Boolean       @default(false)
  allowShip        Boolean       @default(false)
  shippingFeeCents Int?
  visibleInStore   Boolean       @default(true)
  virtual          Boolean       @default(false)
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  productType ProductType         @relation(fields: [productTypeId], references: [id], onDelete: Restrict)
  photos      ProductPhoto[]
  variants    Variant[]
  collections ProductCollection[]

  @@index([status, createdAt(sort: Desc)])
  @@index([productTypeId, status])
  @@index([visibleInStore, status])
}
```

**Modify `model GeneralSettings` (currently lines 547–557): add one nullable column.**

```prisma
model GeneralSettings {
  id                              String              @id @default(cuid())
  ticketCapacityMode              CapacityDisplayMode @default(absolute)
  ticketCapacityThresholdPercent  Int                 @default(15)
  extraCapacityMode               CapacityDisplayMode @default(absolute)
  extraCapacityThresholdPercent   Int                 @default(15)
  productCapacityMode             CapacityDisplayMode @default(absolute)
  productCapacityThresholdPercent Int                 @default(15)
  defaultFreeGarageSpots          Int?
  createdAt                       DateTime            @default(now())
  updatedAt                       DateTime            @updatedAt
}
```

Notes for the engineer:

- `defaultFreeGarageSpots` is `Int?` — `NULL` means "unlimited" per the master plan §3.
- Do NOT supply a Prisma-level default. The migration backfills `1` for existing rows but leaves the schema default `NULL` so an admin saving "Ilimitado" produces `NULL`.

### 2. Migration files — two files following the repo pattern

`ALTER TYPE ADD VALUE` auto-commits in Postgres and cannot be wrapped in a `BEGIN` block alongside other DDL. The existing repo pattern isolates enum-value adds in their own migration file (see `20260424175940_user_role_staff` and `20260516015911_user_deletion_markers`). Follow the same pattern: two migration files.

**File 1: `packages/db/prisma/migrations/20260520120000_garage_spots_enums/migration.sql`**

```sql
-- AlterEnum (must commit before referencing new values in constraints)
CREATE TYPE "GarageSpotTier"   AS ENUM ('free', 'extra', 'premium');
CREATE TYPE "GarageSpotSource" AS ENUM ('default_free', 'purchase', 'admin_grant', 'premium_membership');
ALTER TYPE "FulfillmentMethod" ADD VALUE 'virtual';
ALTER TYPE "FulfillmentStatus" ADD VALUE 'virtual_complete';
```

Note on irreversibility: `ALTER TYPE ADD VALUE` is non-transactional in Postgres and auto-commits immediately. Even if the second migration file fails, the enum values `virtual` and `virtual_complete` are permanently added. Rollback requires enum recreation and column re-cast. At TASK-A merge time no rows reference these values (TASK-C wires them), so a same-day forward fix is acceptable. Document in PR description.

**File 2: `packages/db/prisma/migrations/20260520120100_garage_spots_tables/migration.sql`**

Create the directory and `migration.sql`. Prisma wraps each `migration.sql` in a single transaction; the backfill `DO` block commits atomically with the table and column changes.

Full file contents:

```sql
-- Rollback: see bottom of file. Forward migration is additive; no data loss on rollback
-- aside from the new GarageSpot rows and the defaultFreeGarageSpots column.
-- Note: the enum additions in 20260520120000_garage_spots_enums are NOT reversible
-- without enum recreation + re-cast even if this file is rolled back.

-- ── 1. New columns on existing tables ─────────────────────────────────────
ALTER TABLE "Product"
  ADD COLUMN "visibleInStore" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "virtual"        BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Product_visibleInStore_status_idx" ON "Product"("visibleInStore", "status");

ALTER TABLE "GeneralSettings"
  ADD COLUMN "defaultFreeGarageSpots" INTEGER;

-- ── 2. GarageSpot table ───────────────────────────────────────────────────
CREATE TABLE "GarageSpot" (
    "id"                TEXT             NOT NULL,
    "userId"            TEXT             NOT NULL,
    "tier"              "GarageSpotTier" NOT NULL DEFAULT 'free',
    "source"            "GarageSpotSource" NOT NULL,
    "carId"             TEXT,
    "sourceOrderItemId" TEXT,
    "createdAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "GarageSpot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GarageSpot_carId_key"             ON "GarageSpot"("carId");
CREATE UNIQUE INDEX "GarageSpot_sourceOrderItemId_key" ON "GarageSpot"("sourceOrderItemId");
CREATE        INDEX "GarageSpot_userId_idx"            ON "GarageSpot"("userId");
CREATE        INDEX "GarageSpot_userId_tier_idx"       ON "GarageSpot"("userId", "tier");
CREATE        INDEX "GarageSpot_userId_carId_idx"      ON "GarageSpot"("userId", "carId");

ALTER TABLE "GarageSpot"
  ADD CONSTRAINT "GarageSpot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GarageSpot"
  ADD CONSTRAINT "GarageSpot_carId_fkey"
  FOREIGN KEY ("carId") REFERENCES "Car"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. Backfill ───────────────────────────────────────────────────────────
-- When no GeneralSettings row exists yet: default_free = 1 (no row to update).
-- When a GeneralSettings row exists with defaultFreeGarageSpots IS NULL (unlimited):
--   default_free = 0; the empty-spot step is skipped per master plan §3 point 3.
--   We do NOT write back to defaultFreeGarageSpots — NULL stays NULL (admin-owned).
-- When a GeneralSettings row exists with a set value: use that value.
DO $$
DECLARE
  default_free INT := 1;
  current_setting INT;
  has_settings_row BOOLEAN;
BEGIN
  SELECT COUNT(*) > 0 INTO has_settings_row FROM "GeneralSettings";

  IF has_settings_row THEN
    SELECT "defaultFreeGarageSpots" INTO current_setting FROM "GeneralSettings" ORDER BY "createdAt" ASC LIMIT 1;
    IF current_setting IS NULL THEN
      -- NULL means unlimited; backfill uses 0 empty spots for car-less users.
      -- Do NOT write back to the DB -- NULL is the admin's explicit choice.
      default_free := 0;
    ELSE
      default_free := current_setting;
    END IF;
  END IF;

  -- 3a. One free spot per existing Car. cuid()-style ids are generated by application code,
  -- but in-SQL we need a stable id; use a deterministic prefix + Car.id to keep the row
  -- idempotency-recoverable. Length stays under VARCHAR limits (Car.id is cuid, ~25 chars).
  INSERT INTO "GarageSpot" ("id", "userId", "tier", "source", "carId", "createdAt", "updatedAt")
  SELECT
    'gs_bf_' || c."id",
    c."userId",
    'free'::"GarageSpotTier",
    'default_free'::"GarageSpotSource",
    c."id",
    NOW(),
    NOW()
  FROM "Car" c
  WHERE NOT EXISTS (SELECT 1 FROM "GarageSpot" gs WHERE gs."carId" = c."id");

  -- 3b. For users with zero cars, give them min(default_free, 1) empty free spots.
  -- Spec: §3 migration backfill point 3. If default_free is 0 (unlimited or admin pre-set), insert nothing.
  IF default_free >= 1 THEN
    INSERT INTO "GarageSpot" ("id", "userId", "tier", "source", "carId", "createdAt", "updatedAt")
    SELECT
      'gs_bfempty_' || u."id",
      u."id",
      'free'::"GarageSpotTier",
      'default_free'::"GarageSpotSource",
      NULL,
      NOW(),
      NOW()
    FROM "User" u
    WHERE NOT EXISTS (SELECT 1 FROM "Car" c WHERE c."userId" = u."id")
      AND NOT EXISTS (
        SELECT 1 FROM "GarageSpot" gs
        WHERE gs."userId" = u."id" AND gs."carId" IS NULL AND gs."tier" = 'free'
      );
  END IF;

  -- 3c. AdminAudit entry recording the batch. Singleton entry per migration run.
  INSERT INTO "AdminAudit" ("id", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
  VALUES (
    'audit_garage_backfill_20260520120100',
    'system',
    'general_settings.garage_backfill',
    'general_settings',
    COALESCE((SELECT "id" FROM "GeneralSettings" ORDER BY "createdAt" ASC LIMIT 1), 'general_default'),
    jsonb_build_object(
      'defaultFreeGarageSpots', default_free,
      'carsBackfilled',  (SELECT COUNT(*) FROM "GarageSpot" WHERE "id" LIKE 'gs\_bf\_%' ESCAPE '\'),
      'emptyBackfilled', (SELECT COUNT(*) FROM "GarageSpot" WHERE "id" LIKE 'gs\_bfempty\_%' ESCAPE '\')
    ),
    NOW()
  )
  ON CONFLICT ("id") DO NOTHING;
END $$;

-- Rollback notes
--   The forward migration is fully additive. To roll back:
--   1. DROP TABLE "GarageSpot";
--   2. ALTER TABLE "Product" DROP COLUMN "visibleInStore", DROP COLUMN "virtual";
--   3. ALTER TABLE "GeneralSettings" DROP COLUMN "defaultFreeGarageSpots";
--   4. DROP TYPE "GarageSpotTier";
--   5. DROP TYPE "GarageSpotSource";
--   6. Enum value adds ('virtual', 'virtual_complete') from the first migration file
--      CANNOT be rolled back without recreating the enums. To remove them, recreate
--      "FulfillmentMethod" and "FulfillmentStatus" without those values and re-cast
--      all columns. Do NOT roll back unless production has zero rows referencing them.
--   7. DELETE FROM "AdminAudit" WHERE "id" = 'audit_garage_backfill_20260520120100';
```

Constraints and idempotency:

- The two migration files must be applied in order: `20260520120000_garage_spots_enums` then `20260520120100_garage_spots_tables`. Prisma `migrate deploy` applies them in filename-sort order — the timestamp prefix guarantees this.
- The `gs_bf_<carId>` id collision is the idempotency anchor. Re-running the migration from a clean DB after seed cannot collide (cars don't exist yet). Re-applying the same migration on a partially-migrated DB silently no-ops.
- `gs_bfempty_<userId>` is similarly stable but additionally guarded by the `NOT EXISTS` empty-spot check, so a user who later acquires + deletes a car (creating an empty spot via TASK-B code) does not get a duplicate backfill row if this migration somehow re-runs.
- The LIKE patterns for the AdminAudit metadata counts use `ESCAPE '\'` to treat the underscore literally, so `gs_bfempty_*` rows are counted under `emptyBackfilled` only, not `carsBackfilled`.
- The AdminAudit row id is `audit_garage_backfill_20260520120100` (matches the second file's timestamp).
- The synthetic `'system'` `actorId` on the AdminAudit row is intentional and matches the master plan's "AdminAudit entry per backfill batch". `AdminAudit.actorId` is not FK-constrained in the schema (verified — see schema lines 314–326), so this insert is safe.

### 3. `packages/db/src/garage-spot-product.ts` (new file)

```ts
import { Prisma } from '@prisma/client';

// Singleton identifiers. Keep in @ccc/db so the seed (in this package) and any
// future admin guard (apps/api, TASK-H) share one source of truth.
export const GARAGE_SPOT_PRODUCT_TYPE_NAME = 'garage_spot';
export const GARAGE_SPOT_PRODUCT_SLUG = 'garage-spot';
export const GARAGE_SPOT_VARIANT_NAME = 'Vaga padrão';
export const GARAGE_SPOT_DEFAULT_PRICE_CENTS = 4900;
export const GARAGE_SPOT_DEFAULT_TITLE = 'Vaga de Garagem Adicional';
export const GARAGE_SPOT_DEFAULT_DESCRIPTION =
  'Vaga adicional na sua garagem para registrar mais um carro. Acesso permanente, sem mensalidade.';

export type GarageSpotProductLike = {
  slug: string;
  virtual: boolean;
  visibleInStore: boolean;
  productType: { name: string } | null;
};

export class VirtualSingletonProtectedError extends Error {
  constructor(
    public readonly slug: string,
    public readonly reason: 'delete' | 'duplicate',
  ) {
    super(`Virtual singleton product '${slug}' refused: ${reason}`);
    this.name = 'VirtualSingletonProtectedError';
  }
}

/** Used by seed to refuse duplicate inserts and by admin code (TASK-H) to refuse deletes. */
export const assertVirtualSingletonProtected = (
  op: 'delete' | 'duplicate',
  product: GarageSpotProductLike | null,
): void => {
  if (!product) return;
  if (
    product.slug === GARAGE_SPOT_PRODUCT_SLUG ||
    product.productType?.name === GARAGE_SPOT_PRODUCT_TYPE_NAME
  ) {
    throw new VirtualSingletonProtectedError(product.slug, op);
  }
};

// Prisma include shape used by seed + future admin lookups.
export const garageSpotProductInclude = {
  productType: { select: { name: true } },
} satisfies Prisma.ProductInclude;
```

Then in `packages/db/src/index.ts`, add at the end:

```ts
export * from './garage-spot-product.js';
```

### 4. `packages/db/prisma/seed.ts`

Add the imports at the top. The existing `seed.ts` uses only `@prisma/client` (no `@ccc/db` self-imports). Prefer the relative path to avoid any circular-resolution edge cases with `tsx`:

```ts
import {
  GARAGE_SPOT_DEFAULT_DESCRIPTION,
  GARAGE_SPOT_DEFAULT_PRICE_CENTS,
  GARAGE_SPOT_DEFAULT_TITLE,
  GARAGE_SPOT_PRODUCT_SLUG,
  GARAGE_SPOT_PRODUCT_TYPE_NAME,
  GARAGE_SPOT_VARIANT_NAME,
  assertVirtualSingletonProtected,
} from '../src/garage-spot-product.js';
```

Build `@ccc/db` before running the seed so `dist/` is current.

Add a new function `seedGarageSpotProduct` before `main`:

```ts
const seedGarageSpotProduct = async (): Promise<void> => {
  // 1. ProductType. Upsert by unique name.
  const productType = await prisma.productType.upsert({
    where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    update: { sortOrder: 99 },
    create: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
  });

  // 2. Product. Upsert by unique slug. Refuse to duplicate if a non-singleton row
  //    has somehow claimed the slug or the productType.
  const existing = await prisma.product.findUnique({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    include: { productType: { select: { name: true } } },
  });

  if (existing && existing.productType.name !== GARAGE_SPOT_PRODUCT_TYPE_NAME) {
    // A different product is squatting the slug. Hard fail rather than silently corrupting.
    // assertVirtualSingletonProtected always throws when slug matches, so no further throw needed.
    assertVirtualSingletonProtected('duplicate', {
      slug: existing.slug,
      virtual: existing.virtual,
      visibleInStore: existing.visibleInStore,
      productType: { name: existing.productType.name },
    });
  }

  const product = await prisma.product.upsert({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    update: {
      title: GARAGE_SPOT_DEFAULT_TITLE,
      description: GARAGE_SPOT_DEFAULT_DESCRIPTION,
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
      productTypeId: productType.id,
      // Price is admin-configurable post-seed. Don't clobber an admin-set price on re-run.
    },
    create: {
      slug: GARAGE_SPOT_PRODUCT_SLUG,
      title: GARAGE_SPOT_DEFAULT_TITLE,
      description: GARAGE_SPOT_DEFAULT_DESCRIPTION,
      productTypeId: productType.id,
      basePriceCents: GARAGE_SPOT_DEFAULT_PRICE_CENTS,
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
    },
  });

  // 3. Singleton Variant. quantityTotal=0 is fine: virtual products skip inventory checks (TASK-C).
  const existingVariant = await prisma.variant.findFirst({
    where: { productId: product.id, name: GARAGE_SPOT_VARIANT_NAME },
  });

  if (existingVariant) {
    await prisma.variant.update({
      where: { id: existingVariant.id },
      data: {
        priceCents: product.basePriceCents,
        active: true,
      },
    });
  } else {
    // Refuse if any variant for this product already exists with a different name.
    const anyOtherVariant = await prisma.variant.findFirst({ where: { productId: product.id } });
    if (anyOtherVariant) {
      throw new Error(
        `seed: garage product already has variants; singleton invariant violated (variant.name=${anyOtherVariant.name})`,
      );
    }
    await prisma.variant.create({
      data: {
        productId: product.id,
        name: GARAGE_SPOT_VARIANT_NAME,
        sku: null,
        priceCents: product.basePriceCents,
        quantityTotal: 0,
        attributes: {},
        active: true,
      },
    });
  }

  console.log(
    `Seeded garage spot product: type=${GARAGE_SPOT_PRODUCT_TYPE_NAME}, slug=${GARAGE_SPOT_PRODUCT_SLUG}.`,
  );
};
```

Then at the end of `main`, after the existing `await seedStore();`, add:

```ts
await seedGarageSpotProduct();
```

Idempotency guarantees:

- Re-running the seed N times produces exactly one ProductType, one Product, one Variant.
- If an admin renamed the singleton Product's title via future UI (TASK-H), re-running the seed restores the canonical title/description but **does not** overwrite `basePriceCents`. This is the documented compromise: title is canonical, price is admin-owned.

### 5. `packages/shared/src/garage.ts` (new file)

```ts
import { z } from 'zod';

export const garageSpotTierSchema = z.enum(['free', 'extra', 'premium']);
export type GarageSpotTier = z.infer<typeof garageSpotTierSchema>;

export const garageSpotSourceSchema = z.enum([
  'default_free',
  'purchase',
  'admin_grant',
  'premium_membership',
]);
export type GarageSpotSource = z.infer<typeof garageSpotSourceSchema>;

// Public shape for TASK-B's GET /me/garage. Locked here so TASK-B and TASK-D
// can develop in parallel against a stable contract.
export const garageSpotSchema = z.object({
  id: z.string().min(1),
  tier: garageSpotTierSchema,
  source: garageSpotSourceSchema,
  carId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
});
export type GarageSpot = z.infer<typeof garageSpotSchema>;

// Singleton identifiers re-exported for cross-app use (mobile, admin) where importing
// from @ccc/db is awkward. Keep in sync with packages/db/src/garage-spot-product.ts.
export const GARAGE_SPOT_PRODUCT_SLUG = 'garage-spot';
export const GARAGE_SPOT_PRODUCT_TYPE_NAME = 'garage_spot';
```

### 6. `packages/shared/src/cars.ts` — extend `carSchema`

Modify the existing `carSchema` (currently lines 28–39). The `tier` field ships as `.optional()` in TASK-A. The DB has tier post-backfill but `serializeCar` does not join `GarageSpot` yet (TASK-B owns that). See the three-task hand-off contract below the code block.

```ts
import { z } from 'zod';
import { garageSpotTierSchema } from './garage.js';

export const carInputSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z
    .number()
    .int()
    .min(1900)
    .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' }),
  nickname: z.string().trim().min(1).max(60).optional(),
});
export type CarInput = z.infer<typeof carInputSchema>;

export const carUpdateSchema = carInputSchema.partial();
export type CarUpdateInput = z.infer<typeof carUpdateSchema>;

export const carPhotoSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type CarPhoto = z.infer<typeof carPhotoSchema>;

export const carSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(60).nullable(),
  // TODO TASK-B: tighten to required once serializeCar joins GarageSpot and populates tier.
  // TODO TASK-E: flip to required after all serializers (cars.ts + feed.ts) populate tier.
  tier: garageSpotTierSchema.optional(),
  photo: carPhotoSchema.nullable(),
  photos: z.array(carPhotoSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Car = z.infer<typeof carSchema>;

export const carListResponseSchema = z.object({
  cars: z.array(carSchema),
});
export type CarListResponse = z.infer<typeof carListResponseSchema>;

export const addCarPhotoSchema = z.object({
  objectKey: z.string().min(1).max(300),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type AddCarPhotoInput = z.infer<typeof addCarPhotoSchema>;
```

Three-task hand-off contract for `tier`:

- **TASK-A (this task):** `tier` ships as `.optional()` in `carSchema`. The field is present in the DB post-backfill but `serializeCar` in `apps/api/src/routes/cars.ts` does not yet join `GarageSpot`, so parsed car payloads from the live API will not carry `tier`. Making it required here would break `carSchema.parse(...)` calls in `apps/mobile/src/api/cars.ts` and the existing API integration tests (`apps/api/test/cars/*.test.ts`).
- **TASK-B:** `serializeCar` gains a `GarageSpot` join. `tier` becomes populated on every response. TASK-B must update the `TODO TASK-B` comment to required and remove the `optional()`.
- **TASK-E:** After all serializers (`serializeCar` in cars.ts and `serializeCarProfile` in feed.ts) populate `tier`, the mobile UI (PremiumBadge, tier picker) can treat it as required. TASK-E owns verifying that and removing the `TODO TASK-E` comment.

This progression is the correct sequencing per master plan §9. The `TODO` comments in the schema are load-bearing handoff markers.

### 7. `packages/shared/src/admin.ts` — audit action enum + adminCarUpdateSchema

Modify `adminAuditActionSchema` (currently lines 23–93). Append five new literals; keep the existing entries in place:

```ts
export const adminAuditActionSchema = z.enum([
  // ... existing literals unchanged ...
  'group.create',
  'group.update',
  'group.add_member',
  'group.remove_member',
  'car.admin_update',
  'car.admin_delete',
  'garage_spot.tier_override',
  'garage_spot.delete',
  'general_settings.garage_backfill',
]);
```

Append the following block at the very bottom of `packages/shared/src/admin.ts`:

```ts
// ── Admin garage / car management ──────────────────────────────────────

// Admin-only car update. Reuses public car field constraints but is a strict object
// so unrelated client keys (e.g. tier) are rejected here — tier changes go through
// the dedicated POST /admin/users/:id/cars/:carId/tier endpoint (TASK-G).
export const adminCarUpdateSchema = z
  .object({
    make: z.string().trim().min(1).max(60).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    year: z
      .number()
      .int()
      .min(1900)
      .refine((y) => y <= new Date().getFullYear() + 1, { message: 'year out of range' })
      .optional(),
    nickname: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
        z.string().trim().min(1).max(60).nullable(),
      )
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type AdminCarUpdate = z.infer<typeof adminCarUpdateSchema>;
```

### 8. `packages/shared/src/index.ts` — re-export garage

Add the line:

```ts
export * from './garage.js';
```

### 9. `packages/shared/package.json` — `./garage` export entry

Add to the `exports` map, alphabetically near `./events`:

```json
"./garage": {
  "types": "./src/garage.ts",
  "default": "./dist/garage.js"
},
```

### 10. `apps/api/src/services/admin-audit.ts` — entityType union

Modify the `entityType` union (currently lines 8–31). Append `'car'` and `'garage_spot'`:

```ts
  entityType:
    | 'event'
    | 'tier'
    | 'ticket'
    | 'extra'
    | 'ticket_extra_item'
    | 'user'
    | 'user_group'
    | 'user_group_membership'
    | 'store_collection'
    | 'store_settings'
    | 'general_settings'
    | 'product'
    | 'variant'
    | 'product_type'
    | 'order'
    | 'pickup_voucher'
    | 'support_ticket'
    | 'feed_post'
    | 'feed_comment'
    | 'report'
    | 'feed_ban'
    | 'retention_run'
    | 'dsr'
    | 'car'
    | 'garage_spot';
```

No other changes in `admin-audit.ts`. Callers will be added in TASK-G.

---

## Zod additions in `packages/shared` — at-a-glance

| Symbol                                                      | File        | Purpose                                                                                                                    |
| ----------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `garageSpotTierSchema`                                      | `garage.ts` | Enum for `GarageSpot.tier` and `Car.tier`.                                                                                 |
| `garageSpotSourceSchema`                                    | `garage.ts` | Enum for `GarageSpot.source`.                                                                                              |
| `garageSpotSchema`                                          | `garage.ts` | Public spot shape; consumed by TASK-B `GET /me/garage`.                                                                    |
| `GARAGE_SPOT_PRODUCT_SLUG`, `GARAGE_SPOT_PRODUCT_TYPE_NAME` | `garage.ts` | Constants for cross-app reference (mobile, admin).                                                                         |
| `carSchema.tier` (added, `.optional()`)                     | `cars.ts`   | Present post-backfill in DB; `.optional()` until TASK-B joins `GarageSpot` in `serializeCar`. TASK-E tightens to required. |
| Five literals added to `adminAuditActionSchema`             | `admin.ts`  | TASK-G emits these.                                                                                                        |
| `adminCarUpdateSchema`                                      | `admin.ts`  | TASK-G admin endpoint body.                                                                                                |

---

## Seed script behaviour (idempotent)

Invocation: `pnpm --filter @ccc/db db:seed`.

| Run                                      | Effect                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh DB                                 | Creates `garage_spot` ProductType, singleton Product, singleton Variant. Logs single line.                                                               |
| Re-run                                   | Upserts ProductType + Product; updates Variant priceCents to match `Product.basePriceCents`; preserves admin-set `basePriceCents` (NEVER overwrites it). |
| Slug conflict                            | Throws `Error("seed: product slug 'garage-spot' is owned by a different productType")`. Migration must be rolled back before re-seeding.                 |
| Variant name conflict                    | Throws if any non-singleton variant exists. Hard error — manual cleanup required.                                                                        |
| Slug squatted by a different productType | `assertVirtualSingletonProtected` throws `VirtualSingletonProtectedError`.                                                                               |

The seed never deletes. The "cannot be deleted" rule is enforced at the data-level via:

- The guard `assertVirtualSingletonProtected('delete', ...)` exported from `@ccc/db`. TASK-H will call this from the admin product DELETE handler.
- This task does **not** implement an admin DELETE endpoint. None exists today.

---

## Backfill algorithm (pseudocode)

The SQL in §2 implements this exactly:

```
resolve default_free:
  if GeneralSettings row exists:
    if defaultFreeGarageSpots IS NULL:
      -- NULL means unlimited; do NOT write back to DB (admin owns this value)
      default_free = 0  -- skip empty-spot step for car-less users (master plan §3 point 3)
    else:
      default_free = defaultFreeGarageSpots
  else:
    default_free = 1
    (no row to write; the singleton is created lazily by app code later -- see TASK-F)

for each Car c not yet linked to any GarageSpot:
  insert GarageSpot {
    id            = 'gs_bf_' || c.id    -- stable, idempotent
    userId        = c.userId
    tier          = 'free'
    source        = 'default_free'
    carId         = c.id
  }

if default_free >= 1:
  for each User u with zero Cars and no existing free-empty spot:
    insert GarageSpot {
      id     = 'gs_bfempty_' || u.id    -- stable, idempotent
      userId = u.id
      tier   = 'free'
      source = 'default_free'
      carId  = NULL
    }

insert AdminAudit (id='audit_garage_backfill_20260520120100', actor='system',
                   action='general_settings.garage_backfill', entityType='general_settings',
                   metadata={ defaultFreeGarageSpots, carsBackfilled, emptyBackfilled })
  ON CONFLICT(id) DO NOTHING
```

Cars exceeding the configured free limit are **still backfilled as `tier=free, source=default_free`** (grandfathered, per master plan §3 backfill point 2). Reconciliation does not retroactively flip them to `extra`.

Rollback notes are embedded at the bottom of `migration.sql`. The forward migration is fully additive on existing data — the only data Postgres cannot losslessly roll back is the two enum-value adds (`virtual`, `virtual_complete`), which require enum recreation. Document but do not block.

---

## Test plan

### Vitest harness reminder

- `apps/api/test/global-setup.ts` already spins up a `postgres:16-alpine` Testcontainer and runs `prisma migrate deploy` against it. Adding the new migration directory is automatically picked up; the engineer does NOT need to wire anything.
- `apps/api/test/helpers.ts` `resetDatabase()` already exists. Engineer must extend it with `await prisma.garageSpot.deleteMany();` placed BEFORE `await prisma.car.deleteMany();` (otherwise the FK from `GarageSpot.carId → Car.id` blocks). Insert the line at the appropriate spot in `helpers.ts`.

### A. Shared Zod unit tests — `packages/shared/src/__tests__/garage.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  garageSpotSchema,
  garageSpotSourceSchema,
  garageSpotTierSchema,
  GARAGE_SPOT_PRODUCT_SLUG,
  GARAGE_SPOT_PRODUCT_TYPE_NAME,
} from '../garage.js';
import { carSchema } from '../cars.js';
import { adminAuditActionSchema, adminCarUpdateSchema } from '../admin.js';

describe('garageSpotTierSchema', () => {
  it.each(['free', 'extra', 'premium'] as const)('accepts %s', (tier) => {
    expect(garageSpotTierSchema.parse(tier)).toBe(tier);
  });
  it('rejects unknown tier', () => {
    expect(() => garageSpotTierSchema.parse('platinum')).toThrow();
  });
});

describe('garageSpotSourceSchema', () => {
  it.each(['default_free', 'purchase', 'admin_grant', 'premium_membership'] as const)(
    'accepts %s',
    (s) => {
      expect(garageSpotSourceSchema.parse(s)).toBe(s);
    },
  );
});

describe('garageSpotSchema', () => {
  it('parses a valid empty extra spot', () => {
    const parsed = garageSpotSchema.parse({
      id: 'spot_1',
      tier: 'extra',
      source: 'purchase',
      carId: null,
      createdAt: '2026-05-20T12:00:00.000Z',
    });
    expect(parsed.carId).toBeNull();
  });
  it('rejects when carId is missing entirely', () => {
    expect(() =>
      garageSpotSchema.parse({
        id: 'spot_1',
        tier: 'free',
        source: 'default_free',
        createdAt: '2026-05-20T12:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('carSchema.tier', () => {
  // tier is .optional() in TASK-A — payload without tier parses successfully.
  // TASK-B tightens to required once serializeCar joins GarageSpot.
  it('accepts a car payload without tier (field is optional in TASK-A)', () => {
    const parsed = carSchema.parse({
      id: 'car_1',
      make: 'Toyota',
      model: 'Supra',
      year: 1998,
      nickname: null,
      photo: null,
      photos: [],
      createdAt: '2026-05-20T12:00:00.000Z',
      updatedAt: '2026-05-20T12:00:00.000Z',
    });
    expect(parsed.tier).toBeUndefined();
  });
  it('accepts a car payload with tier present', () => {
    const parsed = carSchema.parse({
      id: 'car_1',
      make: 'Toyota',
      model: 'Supra',
      year: 1998,
      nickname: null,
      tier: 'free',
      photo: null,
      photos: [],
      createdAt: '2026-05-20T12:00:00.000Z',
      updatedAt: '2026-05-20T12:00:00.000Z',
    });
    expect(parsed.tier).toBe('free');
  });
  it('rejects an invalid tier value', () => {
    expect(() =>
      carSchema.parse({
        id: 'car_1',
        make: 'Toyota',
        model: 'Supra',
        year: 1998,
        nickname: null,
        tier: 'platinum',
        photo: null,
        photos: [],
        createdAt: '2026-05-20T12:00:00.000Z',
        updatedAt: '2026-05-20T12:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('adminAuditActionSchema additions', () => {
  it.each([
    'car.admin_update',
    'car.admin_delete',
    'garage_spot.tier_override',
    'garage_spot.delete',
    'general_settings.garage_backfill',
  ] as const)('accepts %s', (a) => {
    expect(adminAuditActionSchema.parse(a)).toBe(a);
  });
});

describe('adminCarUpdateSchema', () => {
  it('rejects empty payload', () => {
    expect(() => adminCarUpdateSchema.parse({})).toThrow();
  });
  it('accepts a single-field update', () => {
    expect(adminCarUpdateSchema.parse({ nickname: 'Beast' })).toEqual({ nickname: 'Beast' });
  });
  it('rejects unknown keys', () => {
    expect(() => adminCarUpdateSchema.parse({ tier: 'premium' })).toThrow();
  });
  it('coerces empty-string nickname to null', () => {
    expect(adminCarUpdateSchema.parse({ nickname: '' })).toEqual({ nickname: null });
  });
});

describe('garage constants', () => {
  it('expose stable singleton identifiers', () => {
    expect(GARAGE_SPOT_PRODUCT_SLUG).toBe('garage-spot');
    expect(GARAGE_SPOT_PRODUCT_TYPE_NAME).toBe('garage_spot');
  });
});
```

Run: `pnpm --filter @ccc/shared test`.

### B. API integration tests against real Postgres

**B-1. Singleton seed idempotency — `apps/api/test/services/garage-spot-singleton.test.ts`**

```ts
import { prisma } from '@ccc/db';
import {
  GARAGE_SPOT_PRODUCT_SLUG,
  GARAGE_SPOT_PRODUCT_TYPE_NAME,
  GARAGE_SPOT_VARIANT_NAME,
} from '@ccc/db';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../../packages/db');

const runSeed = () =>
  execSync('pnpm exec tsx prisma/seed.ts', {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });

describe('garage spot singleton seed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('creates exactly one productType, one product, one variant on first run', async () => {
    runSeed();
    const types = await prisma.productType.findMany({
      where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    });
    const products = await prisma.product.findMany({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    const variants = await prisma.variant.findMany({
      where: { product: { slug: GARAGE_SPOT_PRODUCT_SLUG } },
    });
    expect(types).toHaveLength(1);
    expect(products).toHaveLength(1);
    expect(products[0]!.virtual).toBe(true);
    expect(products[0]!.visibleInStore).toBe(false);
    expect(variants).toHaveLength(1);
    expect(variants[0]!.name).toBe(GARAGE_SPOT_VARIANT_NAME);
  });

  it('is idempotent — running seed three times still yields a single triple', async () => {
    runSeed();
    runSeed();
    runSeed();
    const products = await prisma.product.findMany({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    const variants = await prisma.variant.findMany({
      where: { product: { slug: GARAGE_SPOT_PRODUCT_SLUG } },
    });
    expect(products).toHaveLength(1);
    expect(variants).toHaveLength(1);
  });

  it('does not overwrite admin-set basePriceCents on re-run', async () => {
    runSeed();
    await prisma.product.update({
      where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
      data: { basePriceCents: 9900 },
    });
    runSeed();
    const product = await prisma.product.findUnique({ where: { slug: GARAGE_SPOT_PRODUCT_SLUG } });
    expect(product!.basePriceCents).toBe(9900);
  });

  it('refuses to seed when slug is squatted by a different productType', async () => {
    const otherType = await prisma.productType.create({
      data: { name: 'Vestuário', sortOrder: 0 },
    });
    await prisma.product.create({
      data: {
        slug: GARAGE_SPOT_PRODUCT_SLUG,
        title: 'Squatter',
        description: 'imposter',
        basePriceCents: 1,
        productTypeId: otherType.id,
        status: 'draft',
      },
    });
    expect(() => runSeed()).toThrow();
  });
});
```

Note for the engineer: spawning `tsx prisma/seed.ts` from within Vitest is acceptable for this test — it directly proves end-to-end seed behaviour. The 60s test timeout already configured (`testTimeout: 60_000` in `apps/api/vitest.config.ts`) is sufficient.

**B-2. Migration backfill — `apps/api/test/migrations/garage-spot-backfill.test.ts`**

```ts
import { prisma } from '@ccc/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '../../../../packages/db');

// A separate container so we can reset to "pre-migration" state.
describe('migration: garage spot backfill', () => {
  // Strategy: spin up an *empty* postgres, run all migrations EXCEPT the garage one,
  // seed cars + users, then run prisma migrate deploy to apply the garage migration,
  // and assert backfill produced exactly one GarageSpot per Car and per car-less User.

  it('inserts one free spot per existing car and one empty free spot per car-less user', async () => {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('jdm_bf')
      .withUsername('jdm')
      .withPassword('jdm')
      .start();
    const url = container.getConnectionUri();
    try {
      // 1. Apply ALL migrations including the new one. Then truncate GarageSpot and re-run
      //    the in-migration SQL backfill DO-block manually to test it in isolation.
      execSync('pnpm exec prisma migrate deploy', {
        cwd: dbDir,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });

      const fresh = new PrismaClient({ datasources: { db: { url } } });

      // 2. Seed: 2 users, one with 2 cars, one with zero. GeneralSettings stays default (1).
      const userA = await fresh.user.create({
        data: { email: 'a@jdm.test', name: 'A' },
      });
      await fresh.user.create({
        data: { email: 'b@jdm.test', name: 'B' },
      });
      const car1 = await fresh.car.create({
        data: { userId: userA.id, make: 'Toyota', model: 'Supra', year: 1998 },
      });
      const car2 = await fresh.car.create({
        data: { userId: userA.id, make: 'Nissan', model: 'Skyline', year: 1999 },
      });

      // 3. Wipe GarageSpot to simulate pre-backfill, then re-run the DO-block.
      await fresh.garageSpot.deleteMany();
      // Re-execute the backfill body. Easiest: re-run the migration via prisma migrate resolve + reset
      // on this isolated container. Simpler still: inline the DO-block via $executeRawUnsafe.
      const sqlPath = path.resolve(
        dbDir,
        'prisma/migrations/20260520120100_garage_spots_tables/migration.sql',
      );
      const migrationSql = (await import('node:fs')).readFileSync(sqlPath, 'utf8');
      // Extract the DO $$ ... END $$; block. Run it.
      const doStart = migrationSql.indexOf('DO $$');
      const doEnd = migrationSql.indexOf('END $$;', doStart) + 'END $$;'.length;
      const doBlock = migrationSql.slice(doStart, doEnd);
      await fresh.$executeRawUnsafe(doBlock);

      const spots = await fresh.garageSpot.findMany({ orderBy: { id: 'asc' } });
      expect(spots).toHaveLength(3); // 2 cars + 1 empty for car-less user

      const filled = spots.filter((s) => s.carId !== null);
      expect(filled).toHaveLength(2);
      expect(filled.map((s) => s.carId).sort()).toEqual([car1.id, car2.id].sort());
      filled.forEach((s) => {
        expect(s.tier).toBe('free');
        expect(s.source).toBe('default_free');
      });

      const empties = spots.filter((s) => s.carId === null);
      expect(empties).toHaveLength(1);
      expect(empties[0]!.tier).toBe('free');

      // 4. Re-run the DO-block — must be idempotent.
      await fresh.$executeRawUnsafe(doBlock);
      const spotsAfter = await fresh.garageSpot.findMany();
      expect(spotsAfter).toHaveLength(3);

      // 5. AdminAudit entry recorded.
      const audit = await fresh.adminAudit.findFirst({
        where: { action: 'general_settings.garage_backfill' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.id).toBe('audit_garage_backfill_20260520120100');

      await fresh.$disconnect();
    } finally {
      await container.stop();
    }
  }, 120_000);

  it('honors a custom defaultFreeGarageSpots=0 — does not create empty spots for car-less users', async () => {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('jdm_bf0')
      .withUsername('jdm')
      .withPassword('jdm')
      .start();
    const url = container.getConnectionUri();
    try {
      execSync('pnpm exec prisma migrate deploy', {
        cwd: dbDir,
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });

      const fresh = new PrismaClient({ datasources: { db: { url } } });

      // The DO-block ran during migrate deploy with default_free=1 (no GeneralSettings row yet).
      // Set defaultFreeGarageSpots=0 explicitly, wipe spots, re-run the DO-block.
      await fresh.generalSettings.upsert({
        where: { id: 'general_default' },
        update: { defaultFreeGarageSpots: 0 },
        create: { id: 'general_default', defaultFreeGarageSpots: 0 },
      });
      await fresh.garageSpot.deleteMany();

      const userZero = await fresh.user.create({ data: { email: 'z@jdm.test', name: 'Z' } });

      const sqlPath = path.resolve(
        dbDir,
        'prisma/migrations/20260520120100_garage_spots_tables/migration.sql',
      );
      const migrationSql = (await import('node:fs')).readFileSync(sqlPath, 'utf8');
      const doStart = migrationSql.indexOf('DO $$');
      const doEnd = migrationSql.indexOf('END $$;', doStart) + 'END $$;'.length;
      await fresh.$executeRawUnsafe(migrationSql.slice(doStart, doEnd));

      const empties = await fresh.garageSpot.findMany({ where: { carId: null } });
      expect(empties.filter((s) => s.userId === userZero.id)).toHaveLength(0);

      await fresh.$disconnect();
    } finally {
      await container.stop();
    }
  }, 120_000);
});
```

Engineer note: these tests spin up their own containers and ignore the global one. That's intentional — the global container has already been migrated, and we need to re-run the DO-block in isolation. Total runtime ~30s per test.

**B-3. Car-delete FK behaviour — extend `apps/api/test/services/garage-spot-singleton.test.ts` with one more `describe` block:**

```ts
describe('garage spot FK on car delete', () => {
  it('SetNull preserves the spot row when a car is deleted', async () => {
    const user = await prisma.user.create({ data: { email: 'fk@jdm.test', name: 'FK' } });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'NSX', year: 2002 },
    });
    const spot = await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'free', source: 'default_free', carId: car.id },
    });

    await prisma.car.delete({ where: { id: car.id } });

    const after = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(after).not.toBeNull();
    expect(after!.carId).toBeNull();
    expect(after!.tier).toBe('free');
  });

  it('cascades to GarageSpot when a User is deleted', async () => {
    const user = await prisma.user.create({ data: { email: 'cascade@jdm.test', name: 'C' } });
    const spot = await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'free', source: 'default_free' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const after = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(after).toBeNull();
  });
});
```

### Test commands

```bash
# Shared Zod tests
pnpm --filter @ccc/shared test

# API integration tests (uses Testcontainers, spins up its own postgres)
pnpm --filter @ccc/api test -- --run \
  test/services/garage-spot-singleton.test.ts \
  test/migrations/garage-spot-backfill.test.ts
```

Expected: all pass.

---

## Step-by-step execution (TDD order)

### Task 1: Wire Zod additions in `packages/shared`

- [ ] **Step 1: Write failing Zod unit tests**

Create `packages/shared/src/__tests__/garage.test.ts` with the full content shown above in §test plan A.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @ccc/shared test
```

Expected: FAIL — `garage.ts` doesn't exist, `carSchema.tier`, `adminCarUpdateSchema`, and new audit literals are missing.

- [ ] **Step 3: Add `packages/shared/src/garage.ts`** — full content per §5 above.

- [ ] **Step 4: Modify `packages/shared/src/cars.ts`** — add `import { garageSpotTierSchema } from './garage.js';` and add `tier: garageSpotTierSchema` to `carSchema`. Full file per §6.

- [ ] **Step 5: Modify `packages/shared/src/admin.ts`** — append five literals to `adminAuditActionSchema`; append `adminCarUpdateSchema` block at end. Per §7.

- [ ] **Step 6: Modify `packages/shared/src/index.ts`** — add `export * from './garage.js';`. Per §8.

- [ ] **Step 7: Modify `packages/shared/package.json`** — add `./garage` exports entry. Per §9.

- [ ] **Step 8: Build shared (CLAUDE.md memory: "Rebuild @ccc/shared after schema changes")**

```bash
pnpm --filter @ccc/shared build
```

Expected: clean exit.

- [ ] **Step 9: Run Zod tests — must now pass**

```bash
pnpm --filter @ccc/shared test
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add garage spot Zod schemas + car tier + admin audit literals"
```

### Task 2: Prisma schema + migration

- [ ] **Step 1: Modify `packages/db/prisma/schema.prisma`** per §1.

- [ ] **Step 2: Create both migration directories**

```bash
mkdir -p packages/db/prisma/migrations/20260520120000_garage_spots_enums
mkdir -p packages/db/prisma/migrations/20260520120100_garage_spots_tables
```

- [ ] **Step 3: Create migration files per §2 (both files above).**
  - `packages/db/prisma/migrations/20260520120000_garage_spots_enums/migration.sql` — enum creates and ALTER TYPE ADD VALUE only.
  - `packages/db/prisma/migrations/20260520120100_garage_spots_tables/migration.sql` — columns, table, indexes, FKs, backfill DO block.

- [ ] **Step 4: Generate Prisma client**

```bash
pnpm --filter @ccc/db db:generate
```

Expected: client regenerates without error. New types `GarageSpot`, `GarageSpotTier`, `GarageSpotSource` available, plus `Product.virtual`, `Product.visibleInStore`, `GeneralSettings.defaultFreeGarageSpots`.

- [ ] **Step 5: Build `@ccc/db`**

```bash
pnpm --filter @ccc/db build
```

Expected: clean exit. Note: the new file `packages/db/src/garage-spot-product.ts` is added in Task 3 below — this build step ignores it for now.

- [ ] **Step 6: Verify migration applies on a clean Postgres**

```bash
DATABASE_URL=postgres://jdm:jdm@localhost:5432/jdm_local pnpm --filter @ccc/db db:deploy
```

(Or rely on the integration test in Task 5 if no local Postgres is available.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): add GarageSpot, virtual product flags, defaultFreeGarageSpots + backfill migration (two files)"
```

### Task 3: Singleton-product guard in `@ccc/db`

- [ ] **Step 1: Create `packages/db/src/garage-spot-product.ts`** per §3.

- [ ] **Step 2: Modify `packages/db/src/index.ts`** to re-export it.

- [ ] **Step 3: Build `@ccc/db`**

```bash
pnpm --filter @ccc/db build
```

Expected: clean exit; new symbols exported.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src
git commit -m "feat(db): add garage spot singleton identifiers + protected-product guard"
```

### Task 4: Seed extension

- [ ] **Step 1: Modify `packages/db/prisma/seed.ts`** — add imports + `seedGarageSpotProduct` function + call from `main`. Per §4.

- [ ] **Step 2: Write the failing singleton-seed integration test** — create `apps/api/test/services/garage-spot-singleton.test.ts` with the FIRST `describe` block from §test plan B-1 only.

- [ ] **Step 3: Extend `apps/api/test/helpers.ts` `resetDatabase()`**

Find the line `await prisma.car.deleteMany();` and insert just BEFORE it:

```ts
await prisma.garageSpot.deleteMany();
```

- [ ] **Step 4: Run the seed test**

```bash
pnpm --filter @ccc/api test -- --run test/services/garage-spot-singleton.test.ts
```

Expected: PASS (single product / variant / type created; idempotency holds; price preserved; slug-squat throws).

- [ ] **Step 5: Add the FK-behaviour describe block** from §test plan B-3 to the same file.

- [ ] **Step 6: Re-run the test**

```bash
pnpm --filter @ccc/api test -- --run test/services/garage-spot-singleton.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/seed.ts apps/api/test/helpers.ts apps/api/test/services/garage-spot-singleton.test.ts
git commit -m "feat(db): seed singleton garage spot product + integration tests"
```

### Task 5: Migration backfill integration test

- [ ] **Step 1: Create `apps/api/test/migrations/garage-spot-backfill.test.ts`** per §test plan B-2 (both `it` blocks).

- [ ] **Step 2: Run the backfill test**

```bash
pnpm --filter @ccc/api test -- --run test/migrations/garage-spot-backfill.test.ts
```

Expected: PASS. Two containers spin up, both verify backfill correctness and idempotency, both assert the AdminAudit row.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/migrations
git commit -m "test(db): cover garage spot backfill correctness, idempotency, and zero-limit edge"
```

### Task 6: Admin-audit entityType union

- [ ] **Step 1: Modify `apps/api/src/services/admin-audit.ts`** per §10.

- [ ] **Step 2: Typecheck the API**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/admin-audit.ts
git commit -m "chore(api): extend AdminAudit entityType union with car + garage_spot"
```

### Task 7: Full repo verification

- [ ] **Step 1: Repo-wide typecheck**

```bash
pnpm -r typecheck
```

Expected: clean. If any consumer of `carSchema` outside this task fails — see compatibility caveat under §6. If failures emerge in `apps/mobile` or `apps/admin` because they parse car payloads pre-TASK-B, downgrade `tier` to `.optional()` in this branch and rerun.

- [ ] **Step 2: Repo-wide test**

```bash
pnpm -r test
```

Expected: all suites pass. Existing tests must NOT regress.

- [ ] **Step 3: Repo-wide lint**

```bash
pnpm -r lint
```

Expected: clean.

- [ ] **Step 4: Push branch and open PR (per CLAUDE.md git flow)**

```bash
git push -u origin feat/jdma-garage-task-a
gh pr create --base main --title "feat: garage spots TASK-A — schema, virtual product, seed, backfill" \
  --body "$(cat <<'EOF'
## Summary

- Adds `GarageSpot`, `GarageSpotTier`, `GarageSpotSource` to the schema with a transactional migration that backfills one free spot per existing `Car` and one empty free spot per car-less `User`.
- Adds `Product.virtual` + `Product.visibleInStore` flags and singleton garage spot Product+Variant seed (idempotent, refuses duplicates).
- Adds enum values `FulfillmentMethod.virtual` and `FulfillmentStatus.virtual_complete` (consumed by TASK-C).
- Adds `GeneralSettings.defaultFreeGarageSpots` (consumed by TASK-F).
- Extends `adminAuditActionSchema`, `recordAudit` entityType union, `carSchema.tier`, and adds `adminCarUpdateSchema` in `packages/shared` (consumed by TASK-E + TASK-G).
- Integration tests against a real Postgres (Testcontainers): backfill correctness + idempotency, singleton seed idempotency, FK on-delete behaviour.

Master plan: plans/garage-spots/TASK-A-schema-and-backfill.md.

## Test plan

- [x] `pnpm --filter @ccc/shared test` — Zod unit tests
- [x] `pnpm --filter @ccc/api test` — singleton + backfill integration
- [x] `pnpm -r typecheck && pnpm -r lint`
EOF
)"
```

---

## Risks and open questions

1. **`carSchema.tier` ships as `.optional()`.** Tier is in the DB post-backfill but `serializeCar` (TASK-B) and `serializeCarProfile` (TASK-E) must join `GarageSpot` before they populate it. Any code calling `carSchema.parse(...)` before those joins land will get `tier: undefined` — accepted, not a parse error. TASK-B tightens to required. TASK-E confirms all serializers cover it. See the three-task hand-off table in §downstream unblock map.

2. **Enum-value adds are non-transactional and irreversible.** `ALTER TYPE ADD VALUE` auto-commits in Postgres -- it cannot be rolled back even if the second migration file (`_tables`) fails. The enum-adds file is isolated per repo convention (see `20260424175940_user_role_staff`, `20260516015911_user_deletion_markers`). At TASK-A merge time no rows reference `virtual` or `virtual_complete` (TASK-C wires them), so a same-day forward-fix is fine. Document in the PR description.

2a. **TASK-C must also extend Zod schemas.** The enum DDL (`FulfillmentMethod.virtual`, `FulfillmentStatus.virtual_complete`) lands in TASK-A. TASK-C owns extending `fulfillmentStatusSchema` in `packages/shared/src/orders.ts` and `adminFulfillmentMethodSchema` in `packages/shared/src/admin.ts` to include these values. Without those Zod updates, TASK-C parsers will reject `virtual_complete` payloads at runtime even though the DB column accepts them.

3. **`AdminAudit.actorId='system'` for backfill.** The current schema has no FK on `actorId` (verified — see `schema.prisma` lines 314–326), so the synthetic `'system'` value is safe. If a future migration adds an FK from `AdminAudit.actorId → User.id`, this insert breaks. Mitigation: when that FK is introduced (not in scope here), update the backfill migration retroactively or insert a "system" user beforehand.

4. **Seed import path.** The seed uses a relative import (`'../src/garage-spot-product.js'`) rather than `@ccc/db`. The existing `seed.ts` uses only `@prisma/client` — no `@ccc/db` self-imports exist. Relative path avoids any circular-resolution edge cases under `tsx`. Build `@ccc/db` before running the seed.

5. **`gs_bf_<carId>` id length.** Car ids are cuids (~25 chars). Combined with the prefix the GarageSpot id stays at ~31 chars — well under the typical `TEXT` column limit. No issue, but worth a sanity check during code review.

6. **Backfill on very large existing user tables.** The `DO`-block runs in a single transaction. For the current MVP scale (low thousands of users) this is fine. Documented in master plan §10 as accepted risk. Mitigation if the row count balloons before this lands: convert the empty-spot insert to a chunked loop in the DO-block.

7. **Singleton variant has `quantityTotal=0`.** Anyone running existing low-stock or inventory reports that don't filter by `virtual=true` could see the variant flagged "out of stock". The repo's inventory routes already exist (`adminStoreInventoryRowSchema`). TASK-H trims those UIs to hide virtual products. In the meantime, virtual products in admin inventory views are a known cosmetic issue, not a correctness bug.

8. **Re-running the backfill DO-block after TASK-B starts allocating spots.** The DO-block is guarded by `NOT EXISTS` checks, so it cannot duplicate. However if TASK-B has created additional `tier=free, carId=null` spots for a user via reconcile fanout, the DO-block will (correctly) not add a redundant one. This is the desired behaviour.

---

## Self-review checklist (run before opening PR)

1. **Spec coverage** (against the verbatim TASK-A scope from `Car_spot_plan.md` §9 item 1):
   - `GarageSpot` model + tier/source enums → §1 schema, §2 migration (two files).
   - `Product.virtual` + `Product.visibleInStore` → §1 schema, §2 second migration file.
   - `GeneralSettings.defaultFreeGarageSpots` → §1 schema, §2 second migration file.
   - `FulfillmentMethod=virtual`, `FulfillmentStatus=virtual_complete` → §1 schema, §2 first migration file (enum-only).
   - AdminAudit `adminAuditActionSchema` extensions → §7.
   - AdminAudit `entityType` union extensions → §10.
   - Singleton `garage_spot` ProductType + Product + Variant seed → §4.
   - Migration backfill for every existing Car + every car-less User → §2 DO-block, §backfill pseudocode.
   - Internal-product validation (cannot duplicate; cannot delete) → §3 `assertVirtualSingletonProtected`, §4 seed guards.
   - Real-Postgres integration tests → §test plan B.
   - Shared Zod schemas in `packages/shared` → §5–9.

2. **Placeholder scan**: no TBDs, no "add appropriate X", no "similar to Task N". All code blocks are concrete.

3. **Type consistency**: `garageSpotTierSchema` / `GarageSpotTier` / `tier: garageSpotTierSchema.optional()` referenced identically across `garage.ts`, `cars.ts`, schema.prisma, and migration SQL (`'GarageSpotTier'` enum values lowercase, matching Prisma). `assertVirtualSingletonProtected(op, product)` signature consistent in §3 and §4 callers (single call, no dead throw after).

4. **tier hand-off**: `carSchema.tier` is `.optional()` in TASK-A. Both TODO comments are present. TASK-B tightens to required. TASK-E confirms full serializer coverage.

5. **Branch safety**: Task 1 Step 1 starts AFTER the agent has confirmed `git branch --show-current` is not `production` (per CLAUDE.md). The plan assumes the branch is created via the `superpowers:using-git-worktrees` skill at execution time; no commits land directly on `main`.

---

## Reviewer pushback

No findings pushed back. All 8 reviewer findings were verified correct against the codebase:

1. NULL defaultFreeGarageSpots backfill bug -- confirmed against master plan §3 "if freeLimit=null insert zero."
2. Unescaped LIKE underscore -- confirmed: `'gs_bf_%'` matches `gs_bfempty_xxx` because the bare `_` acts as a single-char wildcard. Fixed with `ESCAPE '\'`.
3. Atomicity claim and migration split -- confirmed: `ALTER TYPE ADD VALUE` auto-commits; repo pattern (`20260424175940`, `20260516015911`) isolates enum adds. Split into two files applied.
4. carSchema.tier required breaks existing serializers -- confirmed: `serializeCar` in `apps/api/src/routes/cars.ts` has no GarageSpot join; `apps/mobile/src/api/cars.ts` and three test files call `carSchema.parse(...)`. Making tier required here would break all of them immediately.
5. TASK-C in unblock map omission -- confirmed: the table had no TASK-C row for settlement creating GarageSpot rows.
6. TASK-C Zod schema gap -- confirmed: `fulfillmentStatusSchema` in `packages/shared/src/orders.ts` does not include `virtual_complete`; TASK-C must extend it.
7. Seed relative import -- confirmed: existing `seed.ts` has zero `@ccc/db` imports; relative path is the correct primary.
8. Dead throw after assertVirtualSingletonProtected -- confirmed: the guard always throws when slug matches; the subsequent `throw new Error(...)` was unreachable.
