# Garage Spots — TASK-B: Public Garage API + Limit Enforcement

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20) — TASK-B is RE-BASELINED
>
> **PR #357 (the original TASK-B implementation) is CLOSED.** The full re-baselined contract lives in [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md). That spec is authoritative for the next TASK-B-prime implementation; this file is reference only.
>
> **Deleted from scope:** `carSchema.tier` projection, `loadTiersForCars`, tier-aware `allocateSpotForCar` return, premium-spot allocation branch, virtual+hidden cart guard tied to per-spot premium.
>
> **Added to scope (per spec):**
>
> - New `Garage` model + migrations + signup hook (eager create with neutral defaults, `isPublic=false`).
> - `PATCH /me/garage` for owner edits (`name, slug, description, isPublic`) with reserved-word + uniqueness validation.
> - Public `GET /g/:slug` route gated on `isPublic=true`; 404 is indistinguishable from unknown-slug 404.
> - `allocateSpotForCar` returns `{ spotId, source }` and uses source-based precedence (no `tier` field anywhere).
> - DSR coverage: extend `account-deletion/anonymize.ts` (scrub Garage row in same tx) and `data-export.ts` (include Garage in export collector).
>
> **Still valid as written:** the cart-guard idea (reject virtual+hidden variants from `/cart/items`), the `Serializable` + P2034 retry pattern, idempotency invariants, the existing `getOrCreateCart` + `tx.cartItem.create` shape for `POST /me/garage/spots/cart`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the user-facing garage HTTP surface: a `reconcileGarageSpots(userId)` service, `GET /me/garage`, spot-aware `POST /me/cars` and `DELETE /me/cars/:id`, an internal-only `POST /me/garage/spots/cart` mutation, plus a server-side guard that blocks the virtual+hidden garage Variant from public `POST /cart/items`.

**Architecture:** A new garage service module owns reconcile + allocation transactions and exposes pure helpers for `GET /me/garage`. Spot allocation runs inside the same Prisma transaction as `Car.create`, using `tx.garageSpot.update({ where: { id: <selected empty spot> } })` after picking the next available spot under `Serializable` isolation. The cart-item validator gains a hard reject for virtual+hidden variants. The internal cart-add path bypasses the validator and calls `getOrCreateCart` + raw `tx.cartItem.create`.

**Tech Stack:** Fastify, Prisma, Zod, vitest, Postgres (real DB via the existing global setup).

**Dependencies:**

- TASK-A is **merged first**. This plan assumes:
  - `GarageSpot` model + `GarageSpotTier` + `GarageSpotSource` enums exist.
  - `Product.virtual` and `Product.visibleInStore` boolean columns exist.
  - `GeneralSettings.defaultFreeGarageSpots Int?` exists.
  - The singleton garage Product (`slug: 'garage-spot'`, `virtual: true`, `visibleInStore: false`, `status: 'active'`) and its one Variant are seeded by `pnpm db:seed`.
  - `ProductType { name: 'garage_spot' }` exists.
  - `AdminAuditAction` enum already covers `general_settings.garage_backfill` (used only by TASK-A migration; TASK-B emits no audit entries).

**Out of scope (other tasks):**

- Schema/seed/migration backfill → TASK-A.
- Virtual-product checkout (cart/checkout.ts skip reservation, FulfillmentMethod=virtual, settlement → GarageSpot fulfillment) → TASK-C.
- Mobile UI → TASK-D.
- Tier picker UI + PremiumBadge → TASK-E.
- Admin General Settings field + reconcile fanout trigger → TASK-F (this plan ships the `reconcileGarageSpots` function; TASK-F wires the PUT route to call it).
- Admin user-detail garage panel + admin endpoints → TASK-G.
- Admin virtual-product editor UI → TASK-H.

**Branch:** Create `feat/jdma-garage-task-b` from fresh `main`. Never branch from `production`.

---

## 1. File Map

### Create

| Path                                             | Responsibility                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/garage.ts`                  | Zod schemas: `garageSpotTierSchema`, `garageSpotSourceSchema`, `garageSpotSchema`, `garagePurchaseOptionSchema`, `garageReadSchema`, `garageCartResponseSchema`.                                                                                       |
| `apps/api/src/services/garage/index.ts`          | `reconcileGarageSpots(userId, tx?)`, `getGarageRead(userId)`, `allocateSpotForCar(tx, userId)`, `releaseSpotForCar(tx, carId)`, `addGarageSpotToCart(userId)`. Constants: `GARAGE_PRODUCT_SLUG`. Allocation precedence + Serializable retry live here. |
| `apps/api/src/routes/garage.ts`                  | Fastify plugin `garageRoutes`: `GET /me/garage`, `POST /me/garage/spots/cart`.                                                                                                                                                                         |
| `apps/api/test/garage/garage-read.test.ts`       | `GET /me/garage` happy path + first-run + unlimited limit cases.                                                                                                                                                                                       |
| `apps/api/test/garage/garage-spot-cart.test.ts`  | `POST /me/garage/spots/cart` adds the garage line; rate limit; auth.                                                                                                                                                                                   |
| `apps/api/test/garage/cart-guard.test.ts`        | Public `POST /cart/items` rejects garage variant by id (spoof).                                                                                                                                                                                        |
| `apps/api/test/garage/limit-transitions.test.ts` | `reconcileGarageSpots` for increase, decrease, decrease-below-filled-count, null (unlimited).                                                                                                                                                          |
| `apps/api/test/garage/cars-allocation.test.ts`   | `POST /me/cars` precedence (free → extra, skip premium), block when no slots, `DELETE` clears `carId`, concurrent add wins exactly once.                                                                                                               |

### Modify

| Path                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/cars.ts`                                                           | Add `tier: garageSpotTierSchema` to `carSchema`. Export from `index.ts` already covers it. **Adding a required field breaks all consumers** (mobile `apps/mobile/src/api/cars.ts`, api `apps/api/src/routes/cars.ts`). Run `grep -rn "carSchema" apps/ packages/` before implementing and update every consumer that parses car payloads without `tier`.                                             |
| `packages/shared/package.json`                                                          | Add `"./garage": { "types": "./src/garage.ts", "default": "./dist/garage.js" }` to the exports map. **Ownership: this entry belongs to TASK-A** (which creates `packages/shared/src/garage.ts`). If TASK-A is already merged with this entry, skip it here. If TASK-A shipped without it, add the entry as the first step of Task 1 before any import from `@jdm/shared/garage` will resolve.        |
| `packages/shared/src/index.ts`                                                          | Add `export * from './garage.js';`.                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/api/src/services/cart/index.ts` (line 661 area, inside `validateProductCartItem`) | Extend the Variant select with `product.virtual` and `product.visibleInStore`. After the `variant.active` / `product.status` check, reject when `variant.product.virtual === true` **AND** `variant.product.visibleInStore === false` (both conditions must hold) with code `VARIANT_INTERNAL_ONLY` / 409. Master plan §3 says "reject garage variants entirely" meaning virtual AND hidden; using ` |     | ` would also block future non-virtual hidden products from the public cart, which is broader than intended. |
| `apps/api/src/routes/cart.ts` (line 497 area, `hasProductItems`)                        | Compute `hasFulfillableProductItems` separately (`item.kind === 'product' && item.variant && item.variant.product.virtual !== true`) so virtual lines no longer demand a fulfillment method or shipping address. Keep the existing `hasProductItems` flag for store-disabled check.                                                                                                                  |
| `apps/api/src/services/cart/index.ts` (`CART_INCLUDE_FOR_SERIALIZE`, lines 58–89)       | Add `virtual: true, visibleInStore: true, status: true` to the inner `product` select so the new route filter has the data it needs.                                                                                                                                                                                                                                                                 |
| `apps/api/src/routes/cars.ts` (lines 58–93)                                             | `POST /me/cars` calls `allocateSpotForCar` inside the create transaction. Return now includes `tier`. `DELETE /me/cars/:id` clears `GarageSpot.carId` in the same transaction as `car.delete`.                                                                                                                                                                                                       |
| `apps/api/src/app.ts` (line 120 area)                                                   | `await app.register(garageRoutes);` immediately after `carRoutes`.                                                                                                                                                                                                                                                                                                                                   |
| `packages/shared/src/cars.ts` test fixtures (if `__tests__/cars.spec.ts` exists)        | Update fixtures to include `tier: 'free'`. (Check before editing.)                                                                                                                                                                                                                                                                                                                                   |

> Line refs are approximate against the snapshot read for this plan; treat them as anchors, not absolute targets. Run `grep -n` if a step claims an anchor that has moved.

---

## 2. Endpoint Contracts (Zod)

All request/response bodies are validated by Zod at the boundary. **Final TypeScript types are inferred from the schemas**, no separate interfaces.

### 2.1 `packages/shared/src/garage.ts` (new)

```ts
import { z } from 'zod';

import { carSchema } from './cars.js';

export const GARAGE_PRODUCT_SLUG = 'garage-spot';

export const garageSpotTierSchema = z.enum(['free', 'extra', 'premium']);
export type GarageSpotTier = z.infer<typeof garageSpotTierSchema>;

export const garageSpotSourceSchema = z.enum([
  'default_free',
  'purchase',
  'admin_grant',
  'premium_membership',
]);
export type GarageSpotSource = z.infer<typeof garageSpotSourceSchema>;

export const garageSpotSchema = z.object({
  id: z.string().min(1),
  tier: garageSpotTierSchema,
  source: garageSpotSourceSchema,
  carId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
});
export type GarageSpot = z.infer<typeof garageSpotSchema>;

export const garagePurchaseOptionSchema = z.object({
  variantId: z.string().min(1),
  basePriceCents: z.number().int().nonnegative(),
  displayPriceCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().min(0).max(100),
  currency: z.string().length(3),
});
export type GaragePurchaseOption = z.infer<typeof garagePurchaseOptionSchema>;

export const garageReadSchema = z.object({
  cars: z.array(carSchema),
  spots: z.array(garageSpotSchema),
  availableSlots: z.number().int().nonnegative(),
  // null means unlimited (admin set `defaultFreeGarageSpots` null)
  freeLimit: z.number().int().nonnegative().nullable(),
  // isUnlimited is true when freeLimit is null. Provided explicitly so TASK-D
  // does not need to re-derive the unlimited state from freeLimit===null.
  // When isUnlimited===true, availableSlots will be 0 (no pre-materialized empties),
  // but the user can add unlimited cars. TASK-D must show the "buy spot" card only
  // when isUnlimited===false && availableSlots===0.
  isUnlimited: z.boolean(),
  purchaseOption: garagePurchaseOptionSchema,
});
export type GarageRead = z.infer<typeof garageReadSchema>;

// Returned by POST /me/garage/spots/cart so the client can route to /cart
// without an extra GET. We reuse the existing cart serializer shape so any
// change there propagates automatically.
export const garageCartResponseSchema = z.object({
  // Defer to the existing cart envelope; we re-export the same shape used by
  // POST /cart/items so the mobile client can reuse its parser.
  cartId: z.string().min(1),
  itemId: z.string().min(1),
});
export type GarageCartResponse = z.infer<typeof garageCartResponseSchema>;
```

### 2.2 `packages/shared/src/cars.ts` (modify)

```ts
// add to imports
import { garageSpotTierSchema } from './garage.js';

// extend carSchema (was lines 28–38). Keep all existing fields; add tier:
export const carSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(60).nullable(),
  photo: carPhotoSchema.nullable(),
  photos: z.array(carPhotoSchema),
  tier: garageSpotTierSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

> Circular import note: `cars.ts` imports from `garage.ts` and `garage.ts` imports `carSchema` from `cars.ts`. Break the cycle by defining `garageSpotTierSchema` first in `garage.ts` (it has no `cars` dependency) and importing **only that enum** into `cars.ts`. The `garageReadSchema` lives in `garage.ts` and pulls `carSchema` from `cars.ts`. ES modules resolve this because both files only import values used at call time. Verified pattern in the existing codebase (`shared/src/cart.ts` imports `eventSchema`).

### 2.3 `GET /me/garage`

- Auth: `app.authenticate`.
- 200 body: `garageReadSchema`.
- `isUnlimited: freeLimit === null`. When `true`, `availableSlots` will be `0` (no pre-materialized empty rows) but the car-add path creates spots lazily. TASK-D must check `isUnlimited` before showing a "buy spot" card: show the card only when `!isUnlimited && availableSlots === 0`.
- `purchaseOption` is computed via:
  ```ts
  const variant = await prisma.variant.findFirstOrThrow({
    where: { product: { slug: GARAGE_PRODUCT_SLUG } },
    select: { id: true, priceCents: true, product: { select: { currency: true } } },
  });
  const fee = applyDevFee(variant.priceCents, app.env.DEV_FEE_PERCENT);
  return {
    variantId: variant.id,
    basePriceCents: fee.baseAmountCents,
    displayPriceCents: fee.grossAmountCents,
    devFeePercent: fee.devFeePercent,
    currency: variant.product.currency,
  };
  ```
- 404 if the singleton variant is missing (defensive — would mean seed was skipped).

### 2.4 `POST /me/garage/spots/cart`

- Auth: `app.authenticate`.
- Empty body.
- 201 body: `garageCartResponseSchema` (`{ cartId, itemId }`).
- Implementation: To avoid a TOCTOU window, use `getActiveCart(userId)` first; if `null`, call `getOrCreateCart(userId)`. Then inside a `prisma.$transaction` verify `cart.status === 'open'` and insert one `CartItem`. If the cart is no longer open (status changed between the outer call and the tx), return 409. See Risk 3 below.
  ```ts
  {
    cartId, eventId: null, tierId: null, variantId: <singleton garage variant>,
    source: 'purchase', kind: 'product', quantity: 1,
    tickets: [],    // static empty array; no cast needed
    metadata: { internal: 'garage_spot' } as unknown as object,
    amountCents: variant.priceCents, currency: variant.product.currency,
  }
  ```
- Increment `cart.version`.
- Idempotency: this endpoint **does not** dedupe — each call adds another line (the user can buy multiple extra spots). This is intentional and by design. **Do not deduplicate in TASK-D.** Multiple lines mean multiple spots purchased in one cart. Idempotency keys for UI double-tap protection are a future concern, not MVP.
- Rate limit: register a scoped `@fastify/rate-limit` decorator at `30/min` per user inside the `garageRoutes` plugin. Use the existing pattern from `me-email-change.ts` / `orders.ts`: `await scoped.register(rateLimit, { max: 30, timeWindow: '1 minute', keyGenerator: (req) => (req as any).user?.sub ?? req.ip })`. No "existing cart write bucket" exists in the codebase; rate-limit is always scoped per-route.

### 2.5 `POST /me/cars` (modified)

Behavior changes:

1. Validate body with `carInputSchema` (unchanged).
2. Open Serializable transaction.
3. Compute `availableSlots = freeEmpty + extraEmpty` (counts inside tx).
4. If `availableSlots === 0`, throw `codedError('Garage is full — buy a spot first', 'GARAGE_FULL', 409)`.
5. Create the `Car` row.
6. Allocate spot (precedence below) by `tx.garageSpot.update({ where: { id: pickedSpotId }, data: { carId } })`.
7. Commit; return serialized car including `tier`.

Errors:

- 409 `GARAGE_FULL` when no available slot.
- Retry up to 3× on `P2034`/`P2002` (same retry pattern used by `getOrCreateCart`).

### 2.6 `DELETE /me/cars/:id` (modified)

- Run a single Prisma `$transaction`:
  1. `const garageRow = await tx.garageSpot.findFirst({ where: { carId: id, user: { id: sub } } });` (or query via `userId` + `carId`).
  2. `await tx.garageSpot.update({ where: { id: garageRow.id }, data: { carId: null } });` if found.
  3. `await tx.car.deleteMany({ where: { id, userId: sub } });`.
- Return 204. The spot row is preserved; tier is unchanged.

### 2.7 Public cart-item rejection

`POST /cart/items` rejects with status 409, body `{ error: 'Conflict', code: 'VARIANT_INTERNAL_ONLY', message: 'Variant is not purchasable from the public cart' }` when the requested variant's product is `virtual=true` **AND** `visibleInStore=false` (both conditions). Using `||` would inadvertently block non-virtual products that happen to have `visibleInStore=false` (e.g. a product under construction). Master plan §3 specifies "reject garage variants entirely" — the garage product has both flags set, so `&&` is the correct guard. This is enforced inside `validateProductCartItem` so PATCH `/cart/items/:itemId` also blocks the variant.

---

## 3. `reconcileGarageSpots(userId, tx?)` Algorithm

### Inputs

- `userId: string`
- Optional `tx` (a `Prisma.TransactionClient`) — if absent, the function opens its own `prisma.$transaction(..., { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 })`.

### Algorithm

```ts
// pseudocode
async function reconcileGarageSpots(userId: string, outerTx?: Tx): Promise<void> {
  const run = async (tx: Tx) => {
    const settings = await tx.generalSettings.findFirst({
      where: { id: 'general_default' },
      select: { defaultFreeGarageSpots: true },
    });
    const freeLimit = settings?.defaultFreeGarageSpots ?? null; // null = unlimited

    const allFree = await tx.garageSpot.findMany({
      where: { userId, tier: 'free' },
      orderBy: { createdAt: 'asc' }, // oldest first → oldest deleted first
      select: { id: true, carId: true },
    });

    const freeFilled = allFree.filter((s) => s.carId !== null).length;
    const freeEmpty = allFree.length - freeFilled;
    const currentFreeTotal = allFree.length;

    if (freeLimit === null) {
      // Unlimited: lazy allocation. Do not pre-create empty rows here.
      // Optional cleanup: remove all empty free rows (they aren't needed).
      const emptyIds = allFree.filter((s) => s.carId === null).map((s) => s.id);
      if (emptyIds.length > 0) {
        await tx.garageSpot.deleteMany({ where: { id: { in: emptyIds } } });
      }
      return;
    }

    // freeLimit is a non-negative integer.
    const targetFreeTotal = Math.max(freeLimit, freeFilled);

    if (currentFreeTotal > targetFreeTotal) {
      const toDelete = currentFreeTotal - targetFreeTotal;
      const idsToDelete = allFree
        .filter((s) => s.carId === null)
        .slice(0, toDelete) // oldest empty rows first (master plan §3)
        .map((s) => s.id);
      if (idsToDelete.length > 0) {
        await tx.garageSpot.deleteMany({ where: { id: { in: idsToDelete } } });
      }
    } else if (currentFreeTotal < targetFreeTotal) {
      const toCreate = targetFreeTotal - currentFreeTotal;
      await tx.garageSpot.createMany({
        data: Array.from({ length: toCreate }, () => ({
          userId,
          tier: 'free',
          source: 'default_free',
          carId: null,
        })),
      });
    }
    // Extra and premium tiers are never touched by reconcile.
  };

  if (outerTx) return run(outerTx);
  await prisma.$transaction(run, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });
}
```

### Concurrency / Retry

- Outer caller (TASK-F, signup hook from TASK-A) **must** wrap in a retry loop on `P2034` (serialization failure):
  ```ts
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await reconcileGarageSpots(userId);
      break;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2034' && attempt < 2) continue;
      throw e;
    }
  }
  ```
  This plan exposes the function; the retry helper is co-located in `services/garage/index.ts` and exported as `reconcileGarageSpotsWithRetry(userId)`.

> **TASK-F and TASK-A consumption contract:** `reconcileGarageSpotsWithRetry` only retries when called _without_ an outer transaction (it opens its own). If TASK-F or any other caller passes an `outerTx`, the retry is skipped and the outer caller owns the retry. Do not call `reconcileGarageSpotsWithRetry` from inside an open transaction — call `reconcileGarageSpots(userId, tx)` instead and handle `P2034` in the outer retry loop.

### Decrease-below-filled invariant

`targetFreeTotal = max(freeLimit, freeFilled)` guarantees we never delete a filled free spot. Example: `freeLimit` drops from 5 → 2, user has 4 filled. `targetFreeTotal = max(2, 4) = 4`. We delete 1 empty (currentFreeTotal 5 → 4). The grandfathered filled spots remain `tier=free, source=default_free`.

### Unlimited handling

When `freeLimit === null`, free spots are **not** pre-materialized — they are created lazily when a car is added (see Allocation Precedence below). Reconcile only cleans up any stale empties created by a previous bounded-limit configuration.

---

## 4. Allocation Precedence (Pseudocode)

Called from `POST /me/cars` inside the create transaction.

```ts
async function allocateSpotForCar(
  tx: Prisma.TransactionClient,
  userId: string,
  carId: string,
): Promise<{ spotId: string; tier: 'free' | 'extra' }> {
  // 1. Try a free empty spot (oldest first).
  const freeEmpty = await tx.garageSpot.findFirst({
    where: { userId, tier: 'free', carId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (freeEmpty) {
    await tx.garageSpot.update({ where: { id: freeEmpty.id }, data: { carId } });
    return { spotId: freeEmpty.id, tier: 'free' };
  }

  // 2. If unlimited free limit, lazily create + claim a fresh free spot.
  // Master plan §3: null column value = unlimited. A missing row is NOT the
  // same as unlimited per the spec. However, ensureGeneralSettings() is called
  // at app boot and upserts the row; the row should always exist in production.
  // In allocateSpotForCar we call ensureGeneralSettings(tx) -- not available
  // inside a tx -- so instead we treat a missing row conservatively:
  // settings === null means the row doesn't exist at all; this should not
  // happen after boot but on a fresh deploy the race window is tiny. Treat it
  // as bounded (not unlimited) to avoid creating unbounded free spots silently.
  // If your deploy needs different behavior, document it explicitly.
  const settings = await tx.generalSettings.findFirst({
    where: { id: 'general_default' },
    select: { defaultFreeGarageSpots: true },
  });
  if (settings !== null && settings.defaultFreeGarageSpots === null) {
    // Column is explicitly null = unlimited. Lazily create + claim a free spot.
    const created = await tx.garageSpot.create({
      data: { userId, tier: 'free', source: 'default_free', carId },
      select: { id: true },
    });
    return { spotId: created.id, tier: 'free' };
  }
  // settings === null (missing row) or settings.defaultFreeGarageSpots is a number:
  // fall through to extra-spot check below.

  // 3. Fall back to an extra empty spot (oldest first).
  const extraEmpty = await tx.garageSpot.findFirst({
    where: { userId, tier: 'extra', carId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (extraEmpty) {
    await tx.garageSpot.update({ where: { id: extraEmpty.id }, data: { carId } });
    return { spotId: extraEmpty.id, tier: 'extra' };
  }

  // 4. Premium empties are NEVER auto-allocated. Bail.
  throw codedError('Garage is full — buy a spot first', 'GARAGE_FULL', 409);
}
```

**Why `findFirst` + `update` instead of `updateMany ... LIMIT 1`?** Prisma's `updateMany` does not return the updated row id, and TASK-B needs to thread the spot id back into the car response (TASK-E displays `tier`). Under Serializable isolation, the race we care about (two requests reading the same empty spot) becomes a serialization failure (`P2034`) and the caller retries. With Read Committed the SELECT-then-UPDATE pattern could double-allocate; that is why the whole car-create transaction runs under `Serializable` isolation. The retry on `P2034` is documented in §3.

`Car.create + allocateSpotForCar` is one atomic unit. If the spot update fails the car insert rolls back. If both succeed, both commit together.

---

## 5. Tasks (TDD, bite-sized)

> Run `git branch --show-current` before the first edit. If it returns `production`, STOP and switch to `main`. Pull `main` with `git pull --ff-only origin main`. Create `feat/jdma-garage-task-b` from `main`.

### Task 1: Add `garageSpotTierSchema` + extend `carSchema` (shared)

**Files:**

- Create: `packages/shared/src/garage.ts`
- Modify: `packages/shared/src/cars.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/garage.spec.ts` (if `__tests__` dir exists; otherwise inline assertion in any new test file)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/garage.spec.ts
import { describe, expect, it } from 'vitest';
import { carSchema } from '../cars.js';
import {
  garageSpotSchema,
  garageSpotTierSchema,
  garagePurchaseOptionSchema,
  garageReadSchema,
} from '../garage.js';

describe('garage schemas', () => {
  it('garageSpotTierSchema accepts the three known tiers', () => {
    expect(garageSpotTierSchema.parse('free')).toBe('free');
    expect(garageSpotTierSchema.parse('extra')).toBe('extra');
    expect(garageSpotTierSchema.parse('premium')).toBe('premium');
    expect(() => garageSpotTierSchema.parse('platinum')).toThrow();
  });

  it('carSchema requires tier', () => {
    const base = {
      id: 'c1',
      make: 'M',
      model: 'M',
      year: 2020,
      nickname: null,
      photo: null,
      photos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(() => carSchema.parse(base)).toThrow();
    expect(carSchema.parse({ ...base, tier: 'free' }).tier).toBe('free');
  });

  it('garageReadSchema accepts unlimited (null) freeLimit', () => {
    const sample = {
      cars: [],
      spots: [],
      availableSlots: 0,
      freeLimit: null,
      purchaseOption: {
        variantId: 'v1',
        basePriceCents: 1000,
        displayPriceCents: 1100,
        devFeePercent: 10,
        currency: 'BRL',
      },
    };
    expect(garageReadSchema.parse(sample)).toEqual(sample);
  });

  it('garageSpotSchema accepts null carId', () => {
    expect(
      garageSpotSchema.parse({
        id: 's1',
        tier: 'free',
        source: 'default_free',
        carId: null,
        createdAt: new Date().toISOString(),
      }).carId,
    ).toBeNull();
  });

  it('garagePurchaseOptionSchema requires BRL-ish 3-char currency', () => {
    expect(() =>
      garagePurchaseOptionSchema.parse({
        variantId: 'v',
        basePriceCents: 0,
        displayPriceCents: 0,
        devFeePercent: 0,
        currency: 'BR',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jdm/shared test -- garage.spec`
Expected: FAIL with "Cannot find module '../garage.js'".

- [ ] **Step 3: Implement schemas**

Write `packages/shared/src/garage.ts` with the full content from §2.1.

Edit `packages/shared/src/cars.ts`:

1. Add `import { garageSpotTierSchema } from './garage.js';` near the existing `import { z } from 'zod';`.
2. Add `tier: garageSpotTierSchema,` to `carSchema`'s object literal (before `createdAt`).

Edit `packages/shared/src/index.ts`: append `export * from './garage.js';` after the last existing export.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @jdm/shared test -- garage.spec`
Expected: PASS.

- [ ] **Step 5: Rebuild shared and run the whole shared test suite**

```bash
pnpm --filter @jdm/shared build
pnpm --filter @jdm/shared test
```

Expected: all tests pass. (Memory rule: rebuild `@jdm/shared` after schema changes.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/garage.ts packages/shared/src/cars.ts packages/shared/src/index.ts packages/shared/src/__tests__/garage.spec.ts
git commit -m "feat(shared): add garage zod schemas and car tier (JDMA-task-b)"
```

---

### Task 2: Patch `serializeCar` to thread `tier` from `GarageSpot`

**Files:**

- Modify: `apps/api/src/routes/cars.ts`
- Test: `apps/api/test/cars/list.test.ts` (modify existing — confirm `tier` present)

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/cars/list.test.ts`:

```ts
it('returns tier on each car', async () => {
  const { user } = await createUser({ verified: true });
  // Seed default_free spot + car directly (TASK-A migration would normally do this).
  const car = await prisma.car.create({
    data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1998 },
  });
  await prisma.garageSpot.create({
    data: { userId: user.id, tier: 'free', source: 'default_free', carId: car.id },
  });
  const env = loadEnv();
  const res = await app.inject({
    method: 'GET',
    url: '/me/cars',
    headers: { authorization: bearer(env, user.id) },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { cars: Array<{ id: string; tier: string }> };
  expect(body.cars[0]!.tier).toBe('free');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jdm/api test -- cars/list`
Expected: FAIL (carSchema parse throws on missing `tier`).

- [ ] **Step 3: Modify `serializeCar` to accept a tier argument**

Change `serializeCar` signature to `(car, uploads, tier: GarageSpotTier)` and pass `tier` into the parsed object. In `GET /me/cars`:

```ts
const cars = await prisma.car.findMany({
  where: { userId: sub },
  include: {
    photos: true,
    // GarageSpot has carId @unique, so this gives 0..1 rows. We declare the
    // relation under the back-relation name added in TASK-A's schema. If the
    // back-relation is named `garageSpot` (singular) use that; otherwise it's
    // `garageSpots` (array) and we read [0]. Verify with `grep -n "GarageSpot"
    // packages/db/prisma/schema.prisma`.
  },
  orderBy: { createdAt: 'desc' },
});
const spots = await prisma.garageSpot.findMany({
  where: { userId: sub, carId: { in: cars.map((c) => c.id) } },
  select: { carId: true, tier: true },
});
const tierByCarId = new Map(spots.map((s) => [s.carId!, s.tier]));
return { cars: cars.map((c) => serializeCar(c, app.uploads, tierByCarId.get(c.id) ?? 'free')) };
```

Apply the same pattern to `GET /me/cars/:id`, `POST /me/cars`, `PATCH /me/cars/:id`, and the photo handlers. For `POST /me/cars` the tier comes from `allocateSpotForCar` (Task 5).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @jdm/api test -- cars/list`
Expected: PASS.

- [ ] **Step 5: Run the rest of the cars suite (sanity)**

Run: `pnpm --filter @jdm/api test -- cars/`
Expected: existing tests pass (delete/photos may need a default `tier: 'free'` insert in their fixtures — fix any failures by adding a `garageSpot.create` mirroring the new list test).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/cars.ts apps/api/test/cars/
git commit -m "feat(api): include garage tier in car serializer (JDMA-task-b)"
```

---

### Task 3: Implement `reconcileGarageSpots` service

**Files:**

- Create: `apps/api/src/services/garage/index.ts`
- Test: `apps/api/test/garage/limit-transitions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/garage/limit-transitions.test.ts
import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileGarageSpots } from '../../src/services/garage/index.js';
import { createUser, resetDatabase } from '../helpers.js';

const setLimit = async (n: number | null) => {
  await prisma.generalSettings.upsert({
    where: { id: 'general_default' },
    update: { defaultFreeGarageSpots: n },
    create: { id: 'general_default', defaultFreeGarageSpots: n },
  });
};

describe('reconcileGarageSpots', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates N empty free spots when increasing from 0', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(3);
    await reconcileGarageSpots(user.id);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(3);
    expect(
      spots.every((s) => s.tier === 'free' && s.source === 'default_free' && s.carId === null),
    ).toBe(true);
  });

  it('deletes empty free spots when decreasing', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(5);
    await reconcileGarageSpots(user.id);
    await setLimit(2);
    await reconcileGarageSpots(user.id);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(2);
  });

  it('never deletes filled free spots when limit drops below filled count', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(5);
    await reconcileGarageSpots(user.id);
    const empties = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    // fill 4
    const cars = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        prisma.car.create({ data: { userId: user.id, make: 'M', model: 'X', year: 2000 + i } }),
      ),
    );
    for (let i = 0; i < 4; i++) {
      await prisma.garageSpot.update({
        where: { id: empties[i]!.id },
        data: { carId: cars[i]!.id },
      });
    }
    await setLimit(2);
    await reconcileGarageSpots(user.id);
    const after = await prisma.garageSpot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(after).toHaveLength(4); // 4 filled preserved, 1 empty deleted
    expect(after.every((s) => s.carId !== null)).toBe(true);
  });

  it('removes all empty free spots when limit becomes null (unlimited)', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(3);
    await reconcileGarageSpots(user.id);
    await setLimit(null);
    await reconcileGarageSpots(user.id);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(0);
  });

  it('never touches extra or premium spots', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'extra', source: 'purchase' },
    });
    await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'premium', source: 'admin_grant' },
    });
    await setLimit(0);
    await reconcileGarageSpots(user.id);
    const counts = await prisma.garageSpot.groupBy({
      by: ['tier'],
      where: { userId: user.id },
      _count: true,
    });
    const byTier = Object.fromEntries(counts.map((c) => [c.tier, c._count]));
    expect(byTier.extra).toBe(1);
    expect(byTier.premium).toBe(1);
  });
});
```

- [ ] **Step 1a: Add `garageSpot.deleteMany()` to `resetDatabase` in `apps/api/test/helpers.ts`**

Before implementing any garage service, add the cleanup call. `GarageSpot` has an FK to `Car` (`onDelete: SetNull`) and to `User` (`onDelete: Cascade`). Safe position: immediately before `prisma.car.deleteMany()` (line 70 area), since `GarageSpot.carId` is nullable — the spot row doesn't block car deletion, but car deletion would leave orphaned `carId` references if SetNull fires inside a cascade. Add it explicitly to control order:

```ts
await prisma.garageSpot.deleteMany(); // must precede car.deleteMany to avoid FK confusion
await prisma.car.deleteMany();
```

Without this, every test that creates a user or car leaks `GarageSpot` rows into subsequent tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jdm/api test -- garage/limit-transitions`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/garage/index.ts`:

```ts
import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';

import { applyDevFee } from '../pricing/dev-fee.js';

// GARAGE_PRODUCT_SLUG is defined in and imported from @jdm/shared/garage.
// It is NOT re-exported from this service to avoid confusion about the source of truth.
// Any file that needs GARAGE_PRODUCT_SLUG imports it directly from '@jdm/shared/garage'.
import { GARAGE_PRODUCT_SLUG } from '@jdm/shared/garage';

type Tx = Prisma.TransactionClient;

// Re-export only for external consumers that already depend on this module path.
// Prefer importing from '@jdm/shared/garage' directly in new code.
// NOTE: remove this export once all callers import directly from @jdm/shared/garage.
// export { GARAGE_PRODUCT_SLUG };  <-- do NOT add this; import directly instead.

export async function reconcileGarageSpots(userId: string, outerTx?: Tx): Promise<void> {
  const run = async (tx: Tx) => {
    const settings = await tx.generalSettings.findFirst({
      where: { id: 'general_default' },
      select: { defaultFreeGarageSpots: true },
    });
    const freeLimit = settings?.defaultFreeGarageSpots ?? null;

    const allFree = await tx.garageSpot.findMany({
      where: { userId, tier: 'free' },
      orderBy: { createdAt: 'asc' }, // oldest first
      select: { id: true, carId: true },
    });
    const freeFilled = allFree.filter((s) => s.carId !== null).length;
    const currentFreeTotal = allFree.length;

    if (freeLimit === null) {
      const emptyIds = allFree.filter((s) => s.carId === null).map((s) => s.id);
      if (emptyIds.length > 0) {
        await tx.garageSpot.deleteMany({ where: { id: { in: emptyIds } } });
      }
      return;
    }

    const targetFreeTotal = Math.max(freeLimit, freeFilled);

    if (currentFreeTotal > targetFreeTotal) {
      const toDelete = currentFreeTotal - targetFreeTotal;
      const idsToDelete = allFree
        .filter((s) => s.carId === null)
        .slice(0, toDelete) // oldest empty rows deleted first (master plan §3)
        .map((s) => s.id);
      if (idsToDelete.length > 0) {
        await tx.garageSpot.deleteMany({ where: { id: { in: idsToDelete } } });
      }
    } else if (currentFreeTotal < targetFreeTotal) {
      const toCreate = targetFreeTotal - currentFreeTotal;
      await tx.garageSpot.createMany({
        data: Array.from({ length: toCreate }, () => ({
          userId,
          tier: 'free' as const,
          source: 'default_free' as const,
          carId: null,
        })),
      });
    }
  };

  if (outerTx) return run(outerTx);
  await prisma.$transaction(run, {
    isolationLevel: 'Serializable',
    maxWait: 5000,
    timeout: 15000,
  });
}

// reconcileGarageSpotsWithRetry must only be called WITHOUT an outer transaction.
// It opens its own Serializable tx internally and retries on P2034.
// If you have an outer tx, call reconcileGarageSpots(userId, tx) instead
// and own the retry loop yourself.
export async function reconcileGarageSpotsWithRetry(userId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await reconcileGarageSpots(userId);
      return;
    } catch (e: unknown) {
      const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : '';
      if (code === 'P2034' && attempt < 2) continue;
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @jdm/api test -- garage/limit-transitions`
Expected: PASS (5 specs).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/garage/index.ts apps/api/test/garage/limit-transitions.test.ts
git commit -m "feat(api): reconcileGarageSpots service with serializable tx (JDMA-task-b)"
```

---

### Task 4: `getGarageRead` + `GET /me/garage` route

**Files:**

- Modify: `apps/api/src/services/garage/index.ts`
- Create: `apps/api/src/routes/garage.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/garage/garage-read.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/garage/garage-read.test.ts
import { prisma } from '@jdm/db';
import { garageReadSchema } from '@jdm/shared/garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const setLimit = async (n: number | null) => {
  await prisma.generalSettings.upsert({
    where: { id: 'general_default' },
    update: { defaultFreeGarageSpots: n },
    create: { id: 'general_default', defaultFreeGarageSpots: n },
  });
};

const seedGarageProduct = async (basePriceCents = 4900) => {
  const pt = await prisma.productType.upsert({
    where: { name: 'garage_spot' },
    update: {},
    create: { name: 'garage_spot', sortOrder: 99 },
  });
  const product = await prisma.product.create({
    data: {
      slug: 'garage-spot',
      title: 'Vaga',
      description: 'd',
      productTypeId: pt.id,
      basePriceCents,
      currency: 'BRL',
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      name: 'singleton',
      priceCents: basePriceCents,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
  return { product, variant };
};

describe('GET /me/garage', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns spots, cars, availableSlots, freeLimit, and a dev-fee-aware purchaseOption', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(2);
    const { variant } = await seedGarageProduct(5000);
    // Materialize free spots so the response shape matches a post-signup state.
    await prisma.garageSpot.createMany({
      data: [
        { userId: user.id, tier: 'free', source: 'default_free' },
        { userId: user.id, tier: 'free', source: 'default_free' },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = garageReadSchema.parse(res.json());
    expect(body.cars).toHaveLength(0);
    expect(body.spots).toHaveLength(2);
    expect(body.availableSlots).toBe(2);
    expect(body.freeLimit).toBe(2);
    expect(body.isUnlimited).toBe(false);
    expect(body.purchaseOption.variantId).toBe(variant.id);
    expect(body.purchaseOption.basePriceCents).toBe(5000);
    expect(body.purchaseOption.devFeePercent).toBe(env.DEV_FEE_PERCENT);
    expect(body.purchaseOption.displayPriceCents).toBe(
      5000 + Math.round((5000 * env.DEV_FEE_PERCENT) / 100),
    );
    expect(body.purchaseOption.currency).toBe('BRL');
  });

  it('returns freeLimit=null for unlimited and no empty spot rows', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(null);
    await seedGarageProduct();
    const res = await app.inject({
      method: 'GET',
      url: '/me/garage',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = garageReadSchema.parse(res.json());
    expect(body.freeLimit).toBeNull();
    expect(body.isUnlimited).toBe(true);
    expect(body.spots).toHaveLength(0);
    // availableSlots is 0 when unlimited and no extras exist.
    // TASK-D: use isUnlimited===true to suppress the "buy spot" card,
    // NOT availableSlots>0.
    expect(body.availableSlots).toBe(0);
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/garage' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jdm/api test -- garage/garage-read`
Expected: FAIL (route not registered → 404).

- [ ] **Step 3: Add `getGarageRead` to the service**

Append to `apps/api/src/services/garage/index.ts`. The `GARAGE_PRODUCT_SLUG` import is already at the top of the file from Task 3 — do not add it again:

```ts
// ... existing exports (GARAGE_PRODUCT_SLUG already imported at top) ...

export async function getGarageReadData(
  userId: string,
  devFeePercent: number,
): Promise<{
  spots: Array<{
    id: string;
    tier: 'free' | 'extra' | 'premium';
    source: string;
    carId: string | null;
    createdAt: Date;
  }>;
  carIds: string[];
  availableSlots: number;
  freeLimit: number | null;
  purchaseOption: {
    variantId: string;
    basePriceCents: number;
    displayPriceCents: number;
    devFeePercent: number;
    currency: string;
  };
}> {
  const [settings, spots, variant] = await Promise.all([
    prisma.generalSettings.findFirst({
      where: { id: 'general_default' },
      select: { defaultFreeGarageSpots: true },
    }),
    prisma.garageSpot.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, tier: true, source: true, carId: true, createdAt: true },
    }),
    prisma.variant.findFirst({
      where: { product: { slug: GARAGE_PRODUCT_SLUG } },
      select: { id: true, priceCents: true, product: { select: { currency: true } } },
    }),
  ]);

  if (!variant) {
    throw Object.assign(new Error('garage product not seeded'), {
      statusCode: 503,
      code: 'GARAGE_PRODUCT_MISSING',
    });
  }

  const availableSlots = spots.filter((s) => s.carId === null && s.tier !== 'premium').length;
  const fee = applyDevFee(variant.priceCents, devFeePercent);

  const freeLimit = settings?.defaultFreeGarageSpots ?? null;

  return {
    spots,
    carIds: spots.filter((s) => s.carId !== null).map((s) => s.carId!),
    availableSlots,
    freeLimit,
    isUnlimited: freeLimit === null,
    purchaseOption: {
      variantId: variant.id,
      basePriceCents: fee.baseAmountCents,
      displayPriceCents: fee.grossAmountCents,
      devFeePercent: fee.devFeePercent,
      currency: variant.product.currency,
    },
  };
}
```

- [ ] **Step 4: Create the route**

`apps/api/src/routes/garage.ts`:

```ts
import { prisma } from '@jdm/db';
import {
  garageReadSchema,
  garageCartResponseSchema,
  GARAGE_PRODUCT_SLUG,
} from '@jdm/shared/garage';
import { carSchema } from '@jdm/shared/cars';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import { getGarageReadData } from '../services/garage/index.js';
import { getOrCreateCart } from '../services/cart/index.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const garageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me/garage', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);

    let data;
    try {
      data = await getGarageReadData(sub, app.env.DEV_FEE_PERCENT);
    } catch (e: unknown) {
      const err = e as { statusCode?: number; code?: string; message?: string };
      if (err.statusCode === 503) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', code: err.code, message: err.message });
      }
      throw e;
    }

    // Fetch the cars with their tier mapped from spots.
    const cars = await prisma.car.findMany({
      where: { userId: sub },
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
    });

    const tierByCarId = new Map(
      data.spots.filter((s) => s.carId !== null).map((s) => [s.carId!, s.tier] as const),
    );

    const serializedCars = cars.map((c) => {
      const sorted = c.photos.slice().sort((a, b) => a.sortOrder - b.sortOrder);
      const buildPhoto = (p: (typeof sorted)[number]) => ({
        id: p.id,
        url: app.uploads.buildPublicUrl(p.objectKey),
        width: p.width,
        height: p.height,
      });
      return carSchema.parse({
        id: c.id,
        make: c.make,
        model: c.model,
        year: c.year,
        nickname: c.nickname,
        photo: sorted[0] ? buildPhoto(sorted[0]) : null,
        photos: sorted.map(buildPhoto),
        tier: tierByCarId.get(c.id) ?? 'free',
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      });
    });

    return garageReadSchema.parse({
      cars: serializedCars,
      spots: data.spots.map((s) => ({
        id: s.id,
        tier: s.tier,
        source: s.source as string,
        carId: s.carId,
        createdAt: s.createdAt.toISOString(),
      })),
      availableSlots: data.availableSlots,
      freeLimit: data.freeLimit,
      isUnlimited: data.isUnlimited,
      purchaseOption: data.purchaseOption,
    });
  });

  app.post('/me/garage/spots/cart', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { sub } = requireUser(request);

    const variant = await prisma.variant.findFirst({
      where: { product: { slug: GARAGE_PRODUCT_SLUG } },
      select: { id: true, priceCents: true, product: { select: { currency: true } } },
    });
    if (!variant) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        code: 'GARAGE_PRODUCT_MISSING',
        message: 'garage spot product not seeded',
      });
    }

    // Avoid TOCTOU: get or create cart outside the tx, then verify status inside.
    const cart = await getOrCreateCart(sub);

    const result = await prisma.$transaction(async (tx) => {
      // Verify the cart is still open inside the tx to avoid TOCTOU.
      const currentCart = await tx.cart.findUnique({
        where: { id: cart.id },
        select: { status: true },
      });
      if (!currentCart || currentCart.status !== 'open') {
        throw Object.assign(new Error('Cart is no longer open'), {
          statusCode: 409,
          code: 'CART_NOT_OPEN',
        });
      }
      const item = await tx.cartItem.create({
        data: {
          cartId: cart.id,
          variantId: variant.id,
          source: 'purchase',
          kind: 'product',
          quantity: 1,
          tickets: [], // static empty array literal; no cast needed
          metadata: { internal: 'garage_spot' } as unknown as object,
          amountCents: variant.priceCents,
          currency: variant.product.currency,
        },
      });
      await tx.cart.update({
        where: { id: cart.id },
        data: { version: { increment: 1 } },
      });
      return { cartId: cart.id, itemId: item.id };
    });

    return reply.status(201).send(garageCartResponseSchema.parse(result));
  });
};
```

- [ ] **Step 5: Register in `app.ts`**

In `apps/api/src/app.ts`, add `import { garageRoutes } from './routes/garage.js';` near `carRoutes` import, and `await app.register(garageRoutes);` immediately after `await app.register(carRoutes);`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @jdm/api test -- garage/garage-read`
Expected: 3 specs PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/garage.ts apps/api/src/services/garage/index.ts apps/api/src/app.ts apps/api/test/garage/garage-read.test.ts
git commit -m "feat(api): GET /me/garage with purchaseOption (JDMA-task-b)"
```

---

### Task 5: Spot-aware `POST /me/cars` with allocation precedence

**Files:**

- Modify: `apps/api/src/services/garage/index.ts` (add `allocateSpotForCar`)
- Modify: `apps/api/src/routes/cars.ts`
- Test: `apps/api/test/garage/cars-allocation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/garage/cars-allocation.test.ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import { reconcileGarageSpots } from '../../src/services/garage/index.js';

const env = loadEnv();

describe('POST /me/cars with garage allocation', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const setLimit = async (n: number | null) => {
    await prisma.generalSettings.upsert({
      where: { id: 'general_default' },
      update: { defaultFreeGarageSpots: n },
      create: { id: 'general_default', defaultFreeGarageSpots: n },
    });
  };

  it('allocates a free spot when one is empty', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(1);
    await reconcileGarageSpots(user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; tier: string };
    expect(body.tier).toBe('free');
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]!.carId).toBe(body.id);
  });

  it('prefers free over extra', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(1);
    await reconcileGarageSpots(user.id);
    await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'extra', source: 'purchase' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Toyota', model: 'Supra', year: 1995 },
    });
    expect((res.json() as { tier: string }).tier).toBe('free');
  });

  it('falls back to extra when free is full', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(0);
    await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'extra', source: 'purchase' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Nissan', model: 'Skyline', year: 1999 },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { tier: string }).tier).toBe('extra');
  });

  it('never auto-allocates premium', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(0);
    await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'premium', source: 'admin_grant' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'M', model: 'X', year: 2010 },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('GARAGE_FULL');
  });

  it('rejects when no slots remain', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(0);
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'M', model: 'X', year: 2010 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('allows infinite cars when freeLimit is null (unlimited)', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(null);
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: { authorization: bearer(env, user.id) },
        payload: { make: 'M', model: 'X', year: 2000 + i },
      });
      expect(res.statusCode).toBe(201);
    }
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(3);
    expect(spots.every((s) => s.tier === 'free' && s.source === 'default_free')).toBe(true);
  });

  it('clears GarageSpot.carId on DELETE /me/cars/:id (preserves tier)', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(1);
    await reconcileGarageSpots(user.id);
    const created = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'M', model: 'X', year: 2000 },
    });
    const carId = (created.json() as { id: string }).id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${carId}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(del.statusCode).toBe(204);
    const spot = await prisma.garageSpot.findFirst({ where: { userId: user.id } });
    expect(spot).not.toBeNull();
    expect(spot!.carId).toBeNull();
    expect(spot!.tier).toBe('free');
  });

  it('concurrent car-add with one free slot allocates to exactly one request', async () => {
    const { user } = await createUser({ verified: true });
    await setLimit(1);
    await reconcileGarageSpots(user.id);
    const headers = { authorization: bearer(env, user.id) };
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/me/cars',
        headers,
        payload: { make: 'A', model: 'A', year: 2001 },
      }),
      app.inject({
        method: 'POST',
        url: '/me/cars',
        headers,
        payload: { make: 'B', model: 'B', year: 2002 },
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots.filter((s) => s.carId !== null)).toHaveLength(1);
    const cars = await prisma.car.findMany({ where: { userId: user.id } });
    expect(cars).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jdm/api test -- garage/cars-allocation`
Expected: FAIL (current route does not allocate).

- [ ] **Step 3: Add `allocateSpotForCar` to the service**

Append to `apps/api/src/services/garage/index.ts`:

```ts
export class GarageFullError extends Error {
  code = 'GARAGE_FULL' as const;
  statusCode = 409 as const;
  constructor() {
    super('Garage is full — buy a spot first');
  }
}

export async function allocateSpotForCar(
  tx: Tx,
  userId: string,
  carId: string,
): Promise<{ spotId: string; tier: 'free' | 'extra' }> {
  const freeEmpty = await tx.garageSpot.findFirst({
    where: { userId, tier: 'free', carId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (freeEmpty) {
    await tx.garageSpot.update({ where: { id: freeEmpty.id }, data: { carId } });
    return { spotId: freeEmpty.id, tier: 'free' };
  }

  const settings = await tx.generalSettings.findFirst({
    where: { id: 'general_default' },
    select: { defaultFreeGarageSpots: true },
  });
  // Only treat as unlimited when the ROW exists and the COLUMN is explicitly null.
  // Master plan §3: "null = unlimited" refers to the column value, not a missing row.
  // A missing row (settings === null) means GeneralSettings was never seeded; treat
  // as bounded (not unlimited) to avoid silent unbounded spot creation on a fresh deploy.
  if (settings !== null && settings.defaultFreeGarageSpots === null) {
    const created = await tx.garageSpot.create({
      data: { userId, tier: 'free', source: 'default_free', carId },
      select: { id: true },
    });
    return { spotId: created.id, tier: 'free' };
  }

  const extraEmpty = await tx.garageSpot.findFirst({
    where: { userId, tier: 'extra', carId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (extraEmpty) {
    await tx.garageSpot.update({ where: { id: extraEmpty.id }, data: { carId } });
    return { spotId: extraEmpty.id, tier: 'extra' };
  }

  throw new GarageFullError();
}

export async function releaseSpotForCar(tx: Tx, carId: string): Promise<void> {
  // Single update is safe: carId @unique means at most one row matches.
  await tx.garageSpot.updateMany({ where: { carId }, data: { carId: null } });
}
```

- [ ] **Step 4: Patch `POST /me/cars` and `DELETE /me/cars/:id`**

Replace the existing `POST /me/cars` handler in `apps/api/src/routes/cars.ts`:

```ts
app.post('/me/cars', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { make, model, year, nickname } = carInputSchema.parse(request.body);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const car = await tx.car.create({
            data: {
              userId: sub,
              make,
              model,
              year,
              ...(nickname !== undefined ? { nickname } : {}),
            },
            include: { photos: true },
          });
          const { tier } = await allocateSpotForCar(tx, sub, car.id);
          return { car, tier };
        },
        { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 },
      );
      return reply.status(201).send(serializeCar(result.car, app.uploads, result.tier));
    } catch (e: unknown) {
      const err = e as { code?: string; statusCode?: number };
      if (err instanceof GarageFullError) {
        return reply
          .status(409)
          .send({ error: 'Conflict', code: 'GARAGE_FULL', message: err.message });
      }
      if (err.code === 'P2034' && attempt < 2) continue;
      throw e;
    }
  }
  return reply
    .status(409)
    .send({ error: 'Conflict', code: 'GARAGE_FULL', message: 'retry exhausted' });
});
```

Replace the existing `DELETE /me/cars/:id` handler:

```ts
app.delete('/me/cars/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
  const { sub } = requireUser(request);
  const { id } = request.params as { id: string };
  const deleted = await prisma.$transaction(async (tx) => {
    const owned = await tx.car.findFirst({ where: { id, userId: sub }, select: { id: true } });
    if (!owned) return false;
    await releaseSpotForCar(tx, id);
    await tx.car.delete({ where: { id } });
    return true;
  });
  if (!deleted) return reply.status(404).send({ error: 'NotFound' });
  return reply.status(204).send();
});
```

Update imports at the top:

```ts
import {
  allocateSpotForCar,
  GarageFullError,
  releaseSpotForCar,
} from '../services/garage/index.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @jdm/api test -- garage/cars-allocation`
Expected: 8 specs PASS, including the concurrent test (the Serializable retry handles `P2034`).

> The concurrent test asserts `[201, 409].sort() == [201, 409]`. If both requests serialize to PASS-then-RETRY-then-FAIL the result is still one 201 + one 409. If retry returns a 409 for the loser, this is the intended behavior. If you see `[409, 409]`, your retry loop is re-throwing too aggressively — re-read the retry code.

> **Concurrency test limitation:** `app.inject` with `Promise.all` runs in a single Node event loop and may not generate a real Serializable conflict (`P2034`) in practice. The HTTP-level test proves the 201/409 outcome but not the database invariant. Add the following lower-level test to `cars-allocation.test.ts` to exercise the actual database race:
>
> ```ts
> it('allocateSpotForCar serializes correctly under concurrent tx (lower-level)', async () => {
>   const { user } = await createUser({ verified: true });
>   await setLimit(1);
>   await reconcileGarageSpots(user.id);
>   const spot = await prisma.garageSpot.findFirst({ where: { userId: user.id } });
>
>   const results = await Promise.allSettled([
>     prisma.$transaction(
>       async (tx) => {
>         const car = await tx.car.create({
>           data: { userId: user.id, make: 'A', model: 'A', year: 2001 },
>         });
>         return allocateSpotForCar(tx, user.id, car.id);
>       },
>       { isolationLevel: 'Serializable' },
>     ),
>     prisma.$transaction(
>       async (tx) => {
>         const car = await tx.car.create({
>           data: { userId: user.id, make: 'B', model: 'B', year: 2002 },
>         });
>         return allocateSpotForCar(tx, user.id, car.id);
>       },
>       { isolationLevel: 'Serializable' },
>     ),
>   ]);
>
>   const successes = results.filter((r) => r.status === 'fulfilled');
>   const failures = results.filter((r) => r.status === 'rejected');
>   // Exactly one succeeds (allocates the spot) and one fails (P2034 or GarageFullError).
>   // With retries at the route level the HTTP test gets [201, 409]; here we see the raw race.
>   expect(successes.length + failures.length).toBe(2);
>   const filledSpots = await prisma.garageSpot.findMany({
>     where: { userId: user.id, carId: { not: null } },
>   });
>   expect(filledSpots).toHaveLength(1);
> });
> ```

- [ ] **Step 6: Run the full cars + garage suite**

Run: `pnpm --filter @jdm/api test -- cars/ garage/`
Expected: all pass. If old `cars/*` tests fail because they no longer seed a spot, add `await prisma.garageSpot.create({ data: { userId: user.id, tier: 'free', source: 'default_free' } })` (or call `reconcileGarageSpots` after setting a free limit of 1) in each test's setup.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/cars.ts apps/api/src/services/garage/index.ts apps/api/test/garage/cars-allocation.test.ts apps/api/test/cars/
git commit -m "feat(api): garage-aware car create/delete with spot allocation (JDMA-task-b)"
```

---

### Task 6: Server-side guard against virtual+hidden variants in public `/cart/items`

**Files:**

- Modify: `apps/api/src/services/cart/index.ts` (validateProductCartItem + CART_INCLUDE_FOR_SERIALIZE)
- Modify: `apps/api/src/routes/cart.ts` (hasFulfillableProductItems)
- Test: `apps/api/test/garage/cart-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/garage/cart-guard.test.ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedGarageVariant = async () => {
  const pt = await prisma.productType.upsert({
    where: { name: 'garage_spot' },
    update: {},
    create: { name: 'garage_spot' },
  });
  const product = await prisma.product.create({
    data: {
      slug: 'garage-spot',
      title: 'Vaga',
      description: 'd',
      productTypeId: pt.id,
      basePriceCents: 5000,
      currency: 'BRL',
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
    },
  });
  return prisma.variant.create({
    data: {
      productId: product.id,
      name: 'singleton',
      priceCents: 5000,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
};

describe('public POST /cart/items rejects virtual+hidden variants', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects garage variant with VARIANT_INTERNAL_ONLY', async () => {
    const { user } = await createUser({ verified: true });
    const variant = await seedGarageVariant();
    const res = await app.inject({
      method: 'POST',
      url: '/cart/items',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        item: {
          kind: 'product',
          variantId: variant.id,
          quantity: 1,
          tickets: [],
        },
      },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('VARIANT_INTERNAL_ONLY');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @jdm/api test -- garage/cart-guard`
Expected: FAIL (current cart accepts it).

- [ ] **Step 3: Patch the validator (~line 637 in services/cart/index.ts)**

In `validateProductCartItem`, extend the `select` for `variant.product`:

```ts
product: {
  select: {
    id: true,
    status: true,
    currency: true,
    shippingFeeCents: true,
    allowShip: true,
    allowPickup: true,
    virtual: true,
    visibleInStore: true,
  },
},
```

Immediately after the existing `if (!variant.active || variant.product.status !== 'active')` check (around line 661), add:

```ts
// Reject only when BOTH flags are set: virtual AND hidden from store.
// Using || would also block non-virtual products with visibleInStore=false (e.g. drafts).
if (variant.product.virtual === true && variant.product.visibleInStore === false) {
  throw codedError('Variant is not purchasable from the public cart', 'VARIANT_INTERNAL_ONLY', 409);
}
```

In `mapValidationError` in `apps/api/src/routes/cart.ts`, add `VARIANT_INTERNAL_ONLY` to the `Conflict / 409` branch:

```ts
if (code === 'VARIANT_NOT_ACTIVE' || code === 'VARIANT_INTERNAL_ONLY') {
  return { error: 'Conflict', status: 409 };
}
```

- [ ] **Step 4: Patch `CART_INCLUDE_FOR_SERIALIZE` and `hasFulfillableProductItems`**

**This step must be done before Step 5 (`hasFulfillableProductItems` split in `cart.ts`).** The split reads `item.variant?.product.virtual`; if `CART_INCLUDE_FOR_SERIALIZE` does not select `virtual`, the field is `undefined` and `!== true` silently passes all items, defeating the guard.

In `apps/api/src/services/cart/index.ts`, add `virtual: true, visibleInStore: true, status: true` to the inner `variant.product` select in `CART_INCLUDE_FOR_SERIALIZE` (lines 74–84).

**Do not edit the `CartWithItems` type literal.** `CartWithItems` is defined as `Prisma.CartGetPayload<{ include: typeof CART_INCLUDE_FOR_SERIALIZE }>` (lines 23-56 show it is inferred via `Prisma.CartGetPayload`). Adding fields to `CART_INCLUDE_FOR_SERIALIZE` automatically propagates to `CartWithItems` — there is no separate literal to edit.

In `apps/api/src/routes/cart.ts` (the `POST /cart/checkout` handler, ~line 497), introduce a virtual-aware split:

```ts
const hasProductItems = cart.items.some((item) => item.kind === 'product');
const hasFulfillableProductItems = cart.items.some(
  (item) => item.kind === 'product' && item.variant && item.variant.product.virtual !== true,
);
const availableMethods = computeAvailableFulfillmentMethods(cart.items, fulfillmentContext);
let resolvedFulfillmentMethod: 'pickup' | 'ship' | null = null;

if (hasFulfillableProductItems) {
  // existing fulfillment-method block (no other change)
  if (availableMethods.length === 0) {
    /* ... */
  }
  // ...
}
```

The `requiresShipping` computation also gates on the same `item.variant?.product.virtual !== true` clause so a virtual line never demands a shipping address.

> TASK-C will further patch `computeAvailableFulfillmentMethods` to ignore virtual product items entirely. For TASK-B we only need the boolean above so the cart-guard test does not push checkout into an inconsistent fulfillment-required state.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @jdm/api test -- garage/cart-guard`
Expected: PASS.

- [ ] **Step 6: Run the wider cart suite to ensure no regression**

Run: `pnpm --filter @jdm/api test -- cart/`
Expected: all existing cart tests still pass. If `cart/checkout.test.ts` breaks because a fixture now reads an undefined `product.virtual`, the schema migration from TASK-A already provides a default `false` — verify the test product fixtures set `virtual: false` explicitly only when needed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/cart/index.ts apps/api/src/routes/cart.ts apps/api/test/garage/cart-guard.test.ts
git commit -m "feat(api): block virtual+hidden variants from public cart (JDMA-task-b)"
```

---

### Task 7: Internal-only `POST /me/garage/spots/cart`

**Files:**

- Modify: `apps/api/src/routes/garage.ts` (already created in Task 4)
- Test: `apps/api/test/garage/garage-spot-cart.test.ts`

> The handler was already written in Task 4. This task adds the test and ensures the integration is correct.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/garage/garage-spot-cart.test.ts
import { prisma } from '@jdm/db';
import { garageCartResponseSchema } from '@jdm/shared/garage';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedGarageVariant = async (priceCents = 5000) => {
  const pt = await prisma.productType.upsert({
    where: { name: 'garage_spot' },
    update: {},
    create: { name: 'garage_spot' },
  });
  const product = await prisma.product.create({
    data: {
      slug: 'garage-spot',
      title: 'Vaga',
      description: 'd',
      productTypeId: pt.id,
      basePriceCents: priceCents,
      currency: 'BRL',
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
    },
  });
  return prisma.variant.create({
    data: {
      productId: product.id,
      name: 'singleton',
      priceCents,
      quantityTotal: 0,
      quantitySold: 0,
      attributes: {},
      active: true,
    },
  });
};

describe('POST /me/garage/spots/cart', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('inserts a single garage line into an open cart', async () => {
    const { user } = await createUser({ verified: true });
    const variant = await seedGarageVariant(5000);
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/spots/cart',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(201);
    const body = garageCartResponseSchema.parse(res.json());
    const items = await prisma.cartItem.findMany({ where: { cartId: body.cartId } });
    expect(items).toHaveLength(1);
    expect(items[0]!.variantId).toBe(variant.id);
    expect(items[0]!.kind).toBe('product');
    expect(items[0]!.quantity).toBe(1);
    expect(items[0]!.amountCents).toBe(5000);
  });

  it('appends another line on repeat call (one per spot bought)', async () => {
    const { user } = await createUser({ verified: true });
    await seedGarageVariant();
    const h = { authorization: bearer(env, user.id) };
    await app.inject({ method: 'POST', url: '/me/garage/spots/cart', headers: h });
    await app.inject({ method: 'POST', url: '/me/garage/spots/cart', headers: h });
    const items = await prisma.cartItem.findMany({});
    expect(items).toHaveLength(2);
  });

  it('503 when garage variant is not seeded', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/garage/spots/cart',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('GARAGE_PRODUCT_MISSING');
  });

  it('401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/me/garage/spots/cart' });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (handler was added in Task 4)**

Run: `pnpm --filter @jdm/api test -- garage/garage-spot-cart`
Expected: 4 specs PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/garage/garage-spot-cart.test.ts
git commit -m "test(api): garage spot cart endpoint coverage (JDMA-task-b)"
```

---

### Task 8: Final integration run + open the PR

- [ ] **Step 1: Run the full test suite**

```bash
pnpm --filter @jdm/shared build
pnpm -r test
```

Expected: all packages pass. Memory rule: rebuild `@jdm/shared` before running api tests because the api consumes `dist/`.

- [ ] **Step 2: Run lint + typecheck**

```bash
pnpm -r typecheck
pnpm -r lint
```

- [ ] **Step 3: Push and open PR to `main`**

```bash
git push -u origin feat/jdma-garage-task-b
gh pr create --base main --title "feat(api): garage spots task B — public api + limit enforcement" \
  --body "$(cat <<'EOF'
## Summary
- Adds `reconcileGarageSpots(userId)` (Serializable tx) + retry helper.
- New `GET /me/garage` with cars, spots, availableSlots, freeLimit, purchaseOption (dev-fee aware).
- `POST /me/cars` allocates a GarageSpot via free → extra precedence; never premium.
- `DELETE /me/cars/:id` clears `GarageSpot.carId` (tier preserved).
- New internal `POST /me/garage/spots/cart` adds the singleton garage variant to the user's open cart.
- Public `POST /cart/items` and `PATCH /cart/items/:id` now reject virtual or hidden variants.
- `carSchema` gains `tier`; new `packages/shared/src/garage.ts` schemas.

## Test plan
- [x] `pnpm --filter @jdm/api test -- garage/`
- [x] `pnpm --filter @jdm/api test -- cars/`
- [x] `pnpm --filter @jdm/api test -- cart/`
- [x] `pnpm --filter @jdm/shared test`
EOF
)"
```

- [ ] **Step 4: Request review only after the PR URL is live** (per CLAUDE.md git-flow rule).

---

## 6. Test Plan (overview)

| Suite             | File                                             | Coverage                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema            | `packages/shared/src/__tests__/garage.spec.ts`   | Tier enum, carSchema includes tier, garageReadSchema accepts null freeLimit, garagePurchaseOptionSchema currency rule.                                                                                   |
| Limit transitions | `apps/api/test/garage/limit-transitions.test.ts` | Increase from 0, decrease, decrease-below-filled invariant, null=unlimited cleanup, extra/premium untouched.                                                                                             |
| Allocation        | `apps/api/test/garage/cars-allocation.test.ts`   | Free precedence, fallback to extra, refuse premium, GARAGE_FULL when empty, unlimited lazy create, DELETE clears carId preserving tier, **concurrent car-add wins exactly once** (Serializable + retry). |
| Garage read       | `apps/api/test/garage/garage-read.test.ts`       | Happy path, unlimited limit, 401, dev-fee math in purchaseOption (`base + base * fee / 100`).                                                                                                            |
| Internal cart-add | `apps/api/test/garage/garage-spot-cart.test.ts`  | Insert single line, repeat appends, 503 when seed missing, 401 without auth.                                                                                                                             |
| Cart guard        | `apps/api/test/garage/cart-guard.test.ts`        | Public `/cart/items` rejects virtual+hidden variant by id (spoof).                                                                                                                                       |

All integration tests rely on the existing `apps/api/test/global-setup.ts` Postgres (real DB), `resetDatabase` between cases, and `makeApp` (or `makeAppWithFakeStripe` if Stripe is touched — none of these are). No mocks for Prisma.

### Dev-fee math assertion (explicit)

In `garage-read.test.ts`:

```ts
expect(body.purchaseOption.displayPriceCents).toBe(
  5000 + Math.round((5000 * env.DEV_FEE_PERCENT) / 100),
);
```

This proves `applyDevFee` was used and that `displayPriceCents = base + round(base * percent / 100)`.

---

## 7. Risks & Open Questions

### Risks

1. **`Variant.product.virtual` schema gate**: this plan assumes TASK-A added the column with `@default(false)`. If TASK-A defaulted differently, the cart-guard test will pass but old products may be incorrectly rejected. Verify the migration sets `virtual=false` on backfill.
2. **Serializable retry exhaustion**: under load, `P2034` retries can return 409 to the _winner_ when the database serializes both transactions but neither sees a free slot on retry. The concurrent test asserts `[201, 409]`; if intermittent flakes appear in CI, raise retry count to 5 and document.
3. **`getOrCreateCart` already exists with Serializable + retry**: nesting `prisma.$transaction` inside its caller is safe because we call it _before_ opening our own tx. Do not call `getOrCreateCart` from inside another open transaction.
4. **Cart shape mismatch in `garageCartResponseSchema`**: we ship a minimal `{ cartId, itemId }` rather than the full cart envelope so the route is cheap. TASK-D's mobile worker may want the full cart; revisit if so.
5. **Empty-spot ordering when reducing limit**: Resolved. `slice(0, toDelete)` deletes the **oldest** empty rows, matching master plan §3 ("oldest first"). The test in Task 3 asserts the count; add an explicit ordering assertion if needed.

### Open questions (to leave in the PR body for review)

- Should `garageCartResponseSchema` echo the full cart (like `upsertCartItemResponseSchema`) so the mobile client can hydrate without a follow-up GET?
- Rate limit bucket for `POST /me/garage/spots/cart` — **resolved**: no shared "cart-write bucket" exists. Uses a dedicated scoped `@fastify/rate-limit` at 30/min per user inside `garageRoutes` (see §2.4 implementation).
- `availableSlots` semantics under unlimited — **resolved**: `isUnlimited: boolean` added to `garageReadSchema`. TASK-D uses `isUnlimited` to decide whether to show "buy spot", not `availableSlots > 0`. `availableSlots` stays as a `nonnegative()` integer reflecting only materialized empties.
- Premium auto-allocation has zero auto-tests beyond the negative case in `cars-allocation`. Does TASK-G need a positive admin-grant test, or does it own that?

---

## 8. Self-Review Checklist

1. **Spec coverage** (Car_spot_plan.md §9 item 2 — TASK-B):
   - `reconcileGarageSpots(userId)` Serializable tx → Task 3.
   - `GET /me/garage` with full payload + purchaseOption → Task 4.
   - `POST /me/cars` precedence (free → extra, never premium), transactional → Task 5.
   - `DELETE /me/cars/:id` clears `GarageSpot.carId` → Task 5.
   - `POST /me/garage/spots/cart` internal-only → Tasks 4 (handler) + 7 (tests).
   - Server-side reject of virtual+hidden in `/cart/items` → Task 6.
   - `packages/shared/src/garage.ts` with three+ schemas → Task 1.
   - `carSchema.tier` → Task 1.
   - Integration tests (real Postgres): limit transitions, concurrent car-add, cart-guard spoof, dev-fee math → Tasks 3, 5, 6, 4.
2. **Placeholder scan**: every code block is concrete. The only "TODO" hooks are flagged as open questions in §7 with explicit decision points.
3. **Type consistency**: `GarageSpotTier` enum is `'free' | 'extra' | 'premium'` in §2.1, §3, §4, §5 Tasks 1/3/5, and tests. `allocateSpotForCar` returns `{ spotId, tier }` consistently. `GarageFullError.code === 'GARAGE_FULL'` matches the route response and the test assertion.

---

## 9. Quick Reference: Acceptance Bar

Plan is done when:

- [ ] `pnpm -r test` is green on the feature branch.
- [ ] `GET /me/garage` returns the documented shape on a real Postgres.
- [ ] `POST /me/cars` returns 409 `GARAGE_FULL` when slots are full; concurrent call test produces exactly one 201.
- [ ] `POST /cart/items` returns 409 `VARIANT_INTERNAL_ONLY` for the garage variant.
- [ ] `POST /me/garage/spots/cart` inserts a `CartItem` with `metadata.internal === 'garage_spot'`.
- [ ] PR opened against `main` (never `production`).

---

## 10. Reviewer Pushback

The following findings from the code review were evaluated against the actual codebase and either partially disputed or accepted with modifications:

### Finding: "Service imports GARAGE_PRODUCT_SLUG from shared, but also re-exports it. Contradiction."

Accepted. The plan's Task 3 Step 3 service code had `export { GARAGE_PRODUCT_SLUG };` at the bottom while also importing it from `@jdm/shared/garage`. This is a contradiction. Fixed: removed the re-export. The constant stays in `@jdm/shared/garage` only. Any file needing it imports directly from `@jdm/shared/garage`.

### Finding: "`./garage` subpath export belongs to TASK-A"

Partially accepted. The reviewer is correct that the `./garage` subpath export must exist in `packages/shared/package.json` before any import from `@jdm/shared/garage` resolves. However, TASK-A is the task that creates `packages/shared/src/garage.ts`, so TASK-A should add the export entry. TASK-B's Task 1 now includes an explicit check: if TASK-A is already merged with the entry, skip it; if not, add it as the first step.

### Finding: "CartWithItems type is inferred via Prisma.CartGetPayload, not a hand-written literal."

Accepted. Verified in `apps/api/src/services/cart/index.ts` lines 23-56: `CartWithItems` is `Prisma.CartGetPayload<{...}>`, not a literal. Task 6 Step 4 now says only `CART_INCLUDE_FOR_SERIALIZE` needs editing; the type follows automatically.

### Finding: "Guard uses `virtual === true || visibleInStore === false`. Conflates two conditions."

Accepted. `&&` is correct per master plan §3 which says reject "garage variants entirely" (virtual AND hidden). Using `||` would inadvertently block non-virtual hidden products. All occurrences in the plan changed to `&&`.

### Finding: "slice(-toDelete) deletes newest empties. Master plan §3 says oldest first."

Accepted and resolved. Changed to `slice(0, toDelete)`. Master plan line 120 is unambiguous: "oldest first". Risk 5 in §7 had deferred this — now resolved.

### Finding: "Treats missing GeneralSettings row as unlimited."

Accepted with clarification. The plan code at line 1270 had `settings === null` treated as unlimited (same branch as `defaultFreeGarageSpots === null`). Master plan §3 says null = unlimited refers to the column value, not a missing row. Fixed: the condition now only treats it as unlimited when `settings !== null && settings.defaultFreeGarageSpots === null`. A missing row falls through to the extra-spot check (treated as bounded). This is safer on fresh deploys.

### Finding: "getOrCreateCart TOCTOU — two concurrent POSTs can both insert CartItem."

Accepted partially. The fix adds an in-transaction cart-status verification after `getOrCreateCart`. This guards against the cart being closed between the `getOrCreateCart` call and the `CartItem.create`. The reviewer's broader concern about concurrent CartItem inserts is addressed by the existing design note: multiple lines are intentional (not deduped). The TOCTOU for cart status is now fixed.

### Finding: "availableSlots=0 for unlimited users. TASK-D may show buy-spot incorrectly."

Accepted. Added `isUnlimited: boolean` to `garageReadSchema`. TASK-D contract: show "buy spot" only when `!isUnlimited && availableSlots === 0`. `availableSlots` stays a non-negative integer. No `Infinity` sentinel needed.

### Finding: "`reconcileGarageSpotsWithRetry` retry ownership note for TASK-F."

Accepted. Added explicit doc comment to the exported function and a note in §3 that the retry wrapper must not be called from inside an outer transaction.

### Finding: "carSchema boundary — all consumers need updating."

Accepted. Added a grep step in the File Map noting that `apps/mobile/src/api/cars.ts` and `apps/api/src/routes/cars.ts` both consume `carSchema`. TASK-B must update all callers that parse car payloads without `tier`.

### Finding: "Pseudocode selects createdAt; actual code in Task 3 Step 3 omits createdAt."

Accepted. Fixed: both the §3 pseudocode and Task 3 service code now use `select: { id: true, carId: true }` (no `createdAt`). The `orderBy: { createdAt: 'asc' }` still works without selecting `createdAt`.

### Finding: "No rate-limit bucket for POST /me/garage/spots/cart — master plan references a non-existent bucket."

Accepted. The master plan says "existing cart write bucket" but no such bucket exists. The codebase uses per-route scoped `@fastify/rate-limit` (verified in `me-email-change.ts`, `orders.ts`). Plan now specifies a dedicated 30/min scoped rate-limit in `garageRoutes`.

### Finding: "`tickets: [] as unknown as object` cast."

Accepted. For a static empty array literal, the `as unknown as object` cast is unnecessary. Changed to `tickets: []`. The `as unknown as object` pattern in the rest of `cart.ts` is for dynamic `input.tickets` from user input (different situation).
