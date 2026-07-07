# Garage per-User Pivot — Design

**Status:** Approved 2026-05-20.
**Supersedes:** Per-spot premium tier in `Car_spot_plan.md` and the per-car `carSchema.tier` contract from TASK-B (PR #357).
**Drives:** Edits to `Car_spot_plan.md` + every `plans/garage-spots/TASK-*.md` file. Closure of PR #357 and a re-baselined TASK-B-prime.

---

## 1. Motivation

The original brainstorm modeled premium membership as a per-`GarageSpot` tier (`free | extra | premium`) and per-`Car.tier` projection. As we got closer to building it, that model conflicted with the actual product intent:

- Premium is a **user-level membership**, not a per-spot attribute. One user, one membership.
- The garage will have a **public profile** (name, description, list of cars). That profile is a first-class thing the user customizes.
- A user's "garage" should be the singular addressable unit — the place premium attaches, the place the public URL points at, the place the bio lives.

The pivot moves premium and the customization surface from spot-level to a new `Garage` model that is 1:1 with `User`. Per-spot tier disappears entirely. The free/extra distinction stays — but it now lives on the existing `GarageSpot.source` enum, which already encodes provenance.

## 2. Data model

### 2.1 New `Garage` model

One per user, eager (signup hook + migration backfill).

```prisma
model Garage {
  id           String              @id @default(cuid())
  userId       String              @unique
  name         String              @db.VarChar(50)
  slug         String              @unique @db.VarChar(40)
  description  String?             @db.VarChar(500)
  isPublic     Boolean             @default(false)
  premiumTier  GaragePremiumTier?
  premiumUntil DateTime?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([slug])
  @@index([premiumTier, premiumUntil])
}

enum GaragePremiumTier {
  bronze
  silver
  gold
}
```

The opposite side of the relation lives on the existing `User` model. Add:

```prisma
model User {
  // ...existing fields...
  garage Garage?
}
```

Optional on Prisma's side (relation field is always nullable on the parent in a 1:1) but the DB enforces 1:1 via `Garage.userId @unique`.

- `premiumTier = null` means basic (no membership). `premiumUntil` is the active-through timestamp; lapsed when `premiumUntil < now()`. The combined `isPremiumActive` boolean is **not persisted** — it is computed inside the API serializer for both `GarageOwner` and `GaragePublic` payloads as `premiumTier !== null && (premiumUntil === null || premiumUntil > now())`. Clients consume the boolean; never the raw timestamp on the public payload.
- `name` required, max 50 chars. Default at signup + backfill: literal string `'Garagem'`. Never derived from `User.name` — that would publish personal data without consent. The user edits it to whatever they want.
- `slug` required, max 40 chars, `^[a-z0-9-]+$`, reserved-word list (`admin`, `api`, `me`, `cart`, `g`, `store`, `health`, `auth`, `signup`, `login`). Default at signup + backfill: `user-<id8>` (first 8 chars of `User.id`). Opaque, non-identifying. User edits it to a vanity slug whenever they want.
- `description` optional, max 500 chars. Free-text bio.
- `isPublic` boolean, default **false**. Controls `/g/:slug` exposure. While `false`, the public route returns 404 even if the slug resolves. Owner still sees their own garage at `/me/garage`. Flipping to `true` is a `PATCH /me/garage { isPublic: true }` call — explicit consent. The mobile garage page shows a "Tornar pública" toggle.

**LGPD posture:** the combination of neutral defaults + `isPublic=false` means no user data is ever surfaced at `/g/:slug` without an explicit toggle. The auto-derived `slugify(user.name)` flow from the prior draft is removed entirely; it leaked the full name into a public URL before the user opted in.

### 2.2 Drop `GarageSpotTier`

The enum and column go away.

```prisma
// REMOVED
enum GarageSpotTier { free, extra, premium }

model GarageSpot {
  // tier field DROPPED
  // @@index([userId, tier]) DROPPED
}
```

Free vs extra is now a function of `source`:

- `source = default_free` → counts toward `freeLimit`.
- `source IN (purchase, admin_grant, premium_membership)` → counts as `extra`.

`premium_membership` stays as a `GarageSpotSource` value because premium memberships may grant bonus spots (treated as extra-class until premium lapses). The name reads slightly oddly post-pivot but renaming the enum would require an enum-DDL migration with no real upside.

### 2.3 Drop `Car.description`

Shipped in PR #356; only a few days old; no production data of material value. The garage-level `Garage.description` is the canonical owner bio going forward. Migration drops the column. `carInputSchema`, `carUpdateSchema`, `carSchema`, mobile car forms all stop referencing `description`.

### 2.4 Unchanged

- `Car.modifications`, `Car.nickname` (from PR #356) keep their post-pivot shape.
- `GeneralSettings.defaultFreeGarageSpots` semantics from TASK-A.
- Singleton virtual garage Product (`slug: 'garage-spot'`) from TASK-A.

## 3. Limit math + allocation

```
freeLimit  = GeneralSettings.defaultFreeGarageSpots  // null = unlimited
freeFilled = count(source = default_free, carId IS NOT NULL)
freeEmpty  = count(source = default_free, carId IS NULL)
extraEmpty = count(source IN (purchase, admin_grant, premium_membership), carId IS NULL)
availableSlots = freeEmpty + extraEmpty
```

`allocateSpotForCar(tx, userId, carId)` precedence:

1. Oldest empty spot where `source = default_free` → claim it.
2. Else if `freeLimit IS NULL` (unlimited) → create new `default_free` spot, claim it.
3. Else oldest empty spot where `source IN (purchase, admin_grant, premium_membership)` → claim it.
4. Else throw `GarageFullError` → API returns 409 `GARAGE_FULL`.

Returns `{ spotId, source }`. The `source` powers the spot's "free / extra" badge in the UI.

`reconcileGarageSpots(userId)` runs at `Serializable` isolation, retries `P2034` up to 3 times. Same semantics as TASK-A/B but every `tier = free` predicate becomes `source = default_free`. Reconcile never deletes purchased or admin-granted spots; only `default_free` empties are subject to limit-driven additions/removals.

When premium lapses, an out-of-scope future job sweeps `source = premium_membership` empties back. Documented but not built here.

## 4. API surface

### 4.1 Private (authed)

| Method   | Path                    | Body                                        | Response (200/201)                                                                                                |
| -------- | ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/me/garage`            | —                                           | `{ garage: GarageOwner, cars: CarRead[], spots: Spot[], availableSlots, freeLimit, isUnlimited, purchaseOption }` |
| `PATCH`  | `/me/garage`            | `{ name?, slug?, description?, isPublic? }` | `{ garage: GarageOwner }`                                                                                         |
| `POST`   | `/me/garage/spots/cart` | `{}`                                        | `{ cartId, itemId }`                                                                                              |
| `POST`   | `/me/cars`              | `carInputSchema`                            | `CarRead`                                                                                                         |
| `DELETE` | `/me/cars/:id`          | —                                           | 204                                                                                                               |

`PATCH /me/garage` validates with `garagePatchSchema` (all fields optional, full constraint set when present). Slug uniqueness collisions return 409 `slug_taken`. Slug edits are rate-limited 10/min/user.

`GarageOwner` (owner-facing) includes `id, name, slug, description, isPublic, premiumTier, premiumUntil, isPremiumActive, createdAt, updatedAt`. Spots and cars are returned as siblings, not nested under garage, to mirror the existing TASK-A `GET /me/garage` shape.

### 4.2 Public

| Method | Path       | Auth | Response                                      |
| ------ | ---------- | ---- | --------------------------------------------- |
| `GET`  | `/g/:slug` | none | `{ garage: GaragePublic, cars: CarPublic[] }` |

`GaragePublic` exposes: `name, slug, description, premiumTier, isPremiumActive`. **Never** `id`, `userId`, `premiumUntil`, `createdAt`, `updatedAt`.

`CarPublic` exposes: `id, make, model, year, nickname, modifications, photos[]`. **Never** `userId`, `createdAt`, `updatedAt`, spot info.

`/g/:slug` rate-limited 60/min/ip. **Returns 404 in two cases:** unknown slug, OR slug resolves to a garage with `isPublic = false`. Indistinguishable by design — never confirm to an anonymous caller that a particular slug is taken. Cache-Control headers TBD when CDN policy lands.

The public payload schemas live in `packages/shared/src/garage-public.ts` (new file) and are the only allowed shape. No Prisma spread to client; the serializer is allowlist-only.

### 4.3 LGPD posture

- **No personal data is exposed on `/g/:slug` without explicit consent.** Defaults are neutral (`name='Garagem'`, `slug='user-<id8>'`) and `isPublic=false`. The user must edit at least one field and toggle `isPublic=true` before anything appears.
- `User.name`, `User.email`, `User.id` never leak through the public payload (see allowlist in §4.2).
- Owners can edit `description` to whatever they want — that field is treated as user-provided public content (same posture as feed posts).
- Admin can override `slug` and force `isPublic=false` to defuse impersonation or take down abusive content (TASK-G).
- **Right to access (DSR export):** the user's `Garage` row (`name, slug, description, isPublic, premiumTier, premiumUntil, createdAt, updatedAt`) is included in the data-export payload. See §6.3 for the file the export collector is extended in.
- **Right to erasure (account anonymization):** when a user account is anonymized, the `Garage` row is scrubbed in the same transaction. `name → 'Garagem'`, `slug → 'deleted-<id8>'` (collision-safe rewrite of the existing slug), `description → null`, `isPublic → false`, `premiumTier → null`, `premiumUntil → null`. Row stays alive (FK to anonymized User) but carries no personal content. The slug rewrite frees the original vanity slug for re-use.

## 5. Migrations

Two new files, run in order after current head (`d6b50e4` + #356 `b6a98c1`):

### 5.1 `20260520120200_drop_garage_spot_tier`

```sql
ALTER TABLE "GarageSpot" DROP COLUMN "tier";
DROP INDEX IF EXISTS "GarageSpot_userId_tier_idx";
DROP TYPE "GarageSpotTier";
```

Data: TASK-A backfill rows all have `tier = free` (irrelevant after drop). TASK-B's per-car tier projections never reached production (PR #357 closes unmerged). No premium spots ever shipped. Safe to drop without data preservation.

### 5.2 `20260520120300_garage_model_and_car_description`

```sql
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
CREATE UNIQUE INDEX "Garage_slug_key" ON "Garage"("slug");
CREATE INDEX "Garage_premiumTier_premiumUntil_idx"
  ON "Garage"("premiumTier", "premiumUntil");
ALTER TABLE "Garage"
  ADD CONSTRAINT "Garage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one Garage row per existing User.
-- Neutral defaults only — no derivation from User.name. Name = 'Garagem',
-- slug = 'user-<id8>'. isPublic stays FALSE (column default) so /g/:slug
-- never exposes anything until the user actively edits + publishes.
-- Slug uniqueness: id-prefix collisions are astronomically unlikely, but the
-- DO block still loops with a numeric suffix to be safe.
DO $$
DECLARE
  u RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR u IN SELECT "id" FROM "User" ORDER BY "createdAt" ASC LOOP
    base := 'user-' || SUBSTR(u.id, 1, 8);
    candidate := base;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM "Garage" WHERE "slug" = candidate) LOOP
      candidate := base || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;

    INSERT INTO "Garage" ("id", "userId", "name", "slug", "createdAt", "updatedAt")
    VALUES (
      'g_bf_' || u.id,
      u.id,
      'Garagem',
      candidate,
      NOW(),
      NOW()
    )
    ON CONFLICT ("userId") DO NOTHING;
  END LOOP;

  -- Audit action 'garage.backfill' must be added to adminAuditActionSchema
  -- in packages/shared/src/admin.ts as part of this PR (see §6.3 file list).
  INSERT INTO "AdminAudit" ("id", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
  VALUES (
    'audit_garage_backfill_20260520120300',
    'system',
    'garage.backfill',
    'general_settings',
    'general_default',
    jsonb_build_object('garagesCreated', (SELECT COUNT(*) FROM "Garage")),
    NOW()
  )
  ON CONFLICT ("id") DO NOTHING;
END $$;

ALTER TABLE "Car" DROP COLUMN "description";
```

Single transaction: `CREATE TYPE` + `CREATE TABLE` + `ALTER TABLE` are all safe in one tx. The auto-commit constraint applies only to `ALTER TYPE ADD VALUE`, which we don't use here.

### 5.3 Signup hook

`apps/api/src/services/auth/signup.ts` (or wherever user creation lives) wraps `User.create` and `Garage.create` in one `prisma.$transaction`. Garage row uses neutral defaults: `name='Garagem'`, `slug='user-<id8>'` (collision-safe loop matching the migration backfill), `isPublic=false`. No `User.name` derivation — same LGPD reasoning as §2.1. If garage creation fails the whole tx rolls back; no orphan users.

### 5.4 Rollback notes

- `drop_garage_spot_tier`: not rollback-safe (column drop). Recreate by re-running the column add + index from TASK-A migration if needed.
- `garage_model_and_car_description`: `DROP TABLE "Garage"; DROP TYPE "GaragePremiumTier"; ALTER TABLE "Car" ADD COLUMN "description" VARCHAR(150);` — restores the column but not its prior contents.

## 6. PR #357 + plan-doc edits

### 6.1 PR #357 fate

Close PR #357 with a comment linking to this spec. Delete the remote branch `feat/jdma-garage-spots-task-b`. Remove the local worktree `.worktrees/garage-spots-task-b`. The shipped commits on that branch (sha `7968a2a` and ancestors) are abandoned; replacement work starts on a new branch from main.

### 6.2 Plan-doc edits

| File                                                                                             | Edit                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Car_spot_plan.md`                                                                               | Schema, limit math, endpoints, backfill, mobile UI, admin UI sections updated to reflect pivot. Premium moves to garage.                                           |
| `plans/garage-spots/TASK-A-schema-and-backfill.md`                                               | Add a "Superseded" header at the top + delta notes. Don't rewrite the body.                                                                                        |
| `plans/garage-spots/TASK-B-public-garage-api.md`                                                 | Full rewrite. Drop `carSchema.tier`. Add `PATCH /me/garage`, `GET /g/:slug`, signup hook. Allocation returns `{ spotId, source }`.                                 |
| `plans/garage-spots/TASK-C-virtual-checkout-and-settlement.md`                                   | Settlement creates `GarageSpot` with `source = purchase`, no tier. Otherwise unchanged.                                                                            |
| `plans/garage-spots/TASK-D-mobile-garage-ui.md`                                                  | All garage settings inline on existing `/garage` page (no separate route). Public profile preview + share link. Drop tier picker. Post-signin routes to `/garage`. |
| `plans/garage-spots/TASK-E-tier-picker-and-premium-badge.md` → renamed `TASK-E-premium-badge.md` | Drop tier picker entirely. PremiumBadge reads `garage.isPremiumActive`.                                                                                            |
| `plans/garage-spots/TASK-F-admin-general-settings.md`                                            | Unchanged.                                                                                                                                                         |
| `plans/garage-spots/TASK-G-admin-user-garage-management.md`                                      | Add admin endpoints to set `garage.premiumTier`, `garage.premiumUntil`, override `slug`. Spot management table drops tier column.                                  |
| `plans/garage-spots/TASK-H-admin-virtual-product-editor-ui.md`                                   | Unchanged.                                                                                                                                                         |

### 6.3 Shipped-code adjustments (all in the new TASK-B-prime PR)

| File                                                   | Action                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                     | Drop `GarageSpot.tier` + index + enum. Add `Garage` model + `GaragePremiumTier`. Drop `Car.description`.                                                                                                                                                             |
| `packages/db/prisma/migrations/20260520120200_*/`      | New.                                                                                                                                                                                                                                                                 |
| `packages/db/prisma/migrations/20260520120300_*/`      | New.                                                                                                                                                                                                                                                                 |
| `packages/db/prisma/seed.ts`                           | Seed Garage rows for the demo users that the seed script creates.                                                                                                                                                                                                    |
| `packages/shared/src/cars.ts`                          | Drop `description` from `carInputSchema`, `carUpdateSchema`, `carSchema`. Drop `tier` from `carSchema`. Drop the `garageSpotTierSchema` import.                                                                                                                      |
| `packages/shared/src/garage.ts`                        | Drop `garageSpotTierSchema`. Reshape `garageReadSchema` (add `garage:` field). Add `garagePatchSchema`.                                                                                                                                                              |
| `packages/shared/src/garage-public.ts`                 | New file. `garagePublicProfileSchema` + `carPublicSchema`.                                                                                                                                                                                                           |
| `packages/shared/src/index.ts`                         | Re-export new schemas.                                                                                                                                                                                                                                               |
| `packages/shared/package.json`                         | Add `./garage-public` exports map entry.                                                                                                                                                                                                                             |
| `packages/shared/src/admin.ts`                         | Extend `adminAuditActionSchema` with `'garage.backfill'`, `'garage.premium_grant'`, `'garage.premium_revoke'`, `'garage.slug_override'`. Extend `entityType` union with `'garage'`.                                                                                  |
| `apps/api/src/routes/garage.ts`                        | Add `PATCH /me/garage`, `GET /g/:slug`. Update `GET /me/garage` payload.                                                                                                                                                                                             |
| `apps/api/src/services/garage/index.ts`                | `allocateSpotForCar` returns `{ spotId, source }`. Drop premium branch. Add `getGarageOwnerRead` + `getGaragePublicRead` + `applyGaragePatch` (slug uniqueness handler).                                                                                             |
| `apps/api/src/routes/cars.ts`                          | Drop `tier` from `serializeCar`. POST `/me/cars` returns the new car shape. PATCH does not project `tier`.                                                                                                                                                           |
| `apps/api/src/services/auth/signup.ts`                 | Wrap user + garage create in one tx. Garage defaults: `name='Garagem'`, `slug='user-<id8>'`, `isPublic=false`. No derivation from `User.name`.                                                                                                                       |
| `apps/api/src/services/account-deletion/anonymize.ts`  | Inside the anonymization tx, scrub the user's `Garage` row: `name='Garagem'`, `slug='deleted-<id8>'` (rewrite frees vanity slug), `description=null`, `isPublic=false`, `premiumTier=null`, `premiumUntil=null`. New step entry `anonymize_garage` in the audit log. |
| `apps/api/src/services/data-export.ts`                 | Add `garage` to the export collector: `{ name, slug, description, isPublic, premiumTier, premiumUntil, createdAt, updatedAt }`. Excludes `id` + `userId` (re-derivable).                                                                                             |
| `apps/api/src/services/cart/index.ts` + `checkout.ts`  | No tier reads. Settlement creates `GarageSpot` with `source=purchase`, no tier.                                                                                                                                                                                      |
| `apps/api/src/routes/admin/...`                        | TASK-G additions: grant/revoke premium, override slug. Spot rows in admin lists no longer include tier.                                                                                                                                                              |
| `apps/admin/src/...`                                   | Spot table drops tier column. User detail surfaces garage info.                                                                                                                                                                                                      |
| `apps/mobile/src/api/cars.ts`                          | `Car` type drops `tier` and `description`.                                                                                                                                                                                                                           |
| `apps/mobile/src/api/garage.ts` (new or extended)      | Garage type + `PATCH /me/garage` client + `/g/:slug` (anon) client.                                                                                                                                                                                                  |
| `apps/mobile/src/screens/Garage/*`                     | Inline edit affordances for `name`, `slug`, `description`. Public Profile preview + share link. Drop tier picker. PremiumBadge reads `garage.isPremiumActive`.                                                                                                       |
| `apps/mobile/src/screens/Onboarding/*` (or app router) | Default landing to `/garage` post-signin. Empty-state CTA "Adicione seu primeiro carro".                                                                                                                                                                             |
| `apps/mobile/src/screens/Cars/*`                       | Car forms drop `description` field.                                                                                                                                                                                                                                  |

## 7. Wave plan (post-pivot)

- **Wave 2 (re-baseline):** TASK-B-prime — schema migrations, shared schemas, `/me/garage` (owner) + `PATCH /me/garage` + `/g/:slug` (public) + signup hook + `reconcileGarageSpots` + `allocateSpotForCar(source)`.
- **Wave 3 (parallel ×5):** TASK-C (virtual checkout/settle), TASK-D (mobile garage page with inline edits + public profile preview + post-signin routing), TASK-E (premium badge — Garage-level), TASK-F (admin general settings), TASK-G (admin user-garage + premium grant/revoke), TASK-H (admin virtual-product editor).

TASK-B-prime is the only blocker. Everything else parallelizes after merge.

## 8. Acceptance bar

- [ ] `pnpm -r test` green.
- [ ] PR #357 closed; replacement branch opened from main with the pivoted TASK-B-prime.
- [ ] Migration applies cleanly against a DB that already has TASK-A applied (the `drop tier` step is data-lossless for the current row population).
- [ ] `GET /me/garage` returns `garage` + `cars` + `spots` (no `cars[].tier`).
- [ ] `PATCH /me/garage` enforces slug uniqueness + reserved-word list + accepts `isPublic`.
- [ ] `GET /g/:slug` returns the allowlisted public shape and only the allowlisted public shape. Returns 404 when `isPublic=false` (indistinguishable from unknown slug).
- [ ] New users post-signup have a Garage row with `name='Garagem'`, opaque `slug='user-<id8>'`, `isPublic=false`. `User.name` is never the source of any Garage field.
- [ ] Data export includes the user's Garage fields per §6.3.
- [ ] Account anonymization scrubs the Garage row per §4.3 (verified with an integration test in `apps/api/test/account-deletion/`).
- [ ] Mobile `/garage` page has inline edit affordances for name/slug/description, plus a `isPublic` toggle ("Tornar pública") and a share-link control that respects the toggle state.
- [ ] Post-signin, the mobile app lands on `/garage`.

## 9. Out of scope (deferred)

- Premium membership purchase flow + Stripe-recurring + grant logic. Adds `Garage.premiumTier` / `premiumUntil` writes. Future TASK.
- Sweep job for `source = premium_membership` empties when premium lapses. Future TASK.
- Cache-Control / CDN policy for `/g/:slug`. Future infra task.
- First-car-add inside the signup wizard (MVP just lands on `/garage` with an empty-state CTA).
