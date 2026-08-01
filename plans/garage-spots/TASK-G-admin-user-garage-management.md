# TASK-G — Admin User-Detail Car + Spot Management Implementation Plan

> ## ⚠️ POST-PIVOT NOTICE (2026-05-20)
>
> **Canonical source:** [`docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md`](../../docs/superpowers/specs/2026-05-20-garage-per-user-pivot-design.md).
>
> **Deleted from scope:** the "override spot tier" endpoint and the spot-tier column on the admin grid — no per-spot tier exists post-pivot.
>
> **Added to scope:**
>
> - Admin endpoints to set `Garage.premiumTier` (`bronze` / `silver` / `gold`), set `Garage.premiumUntil`, and clear both ("revoke premium"). Audit actions `garage.premium_grant` + `garage.premium_revoke` (added to `adminAuditActionSchema` by TASK-B-prime).
> - Admin endpoint to override `Garage.slug` and force-flip `Garage.isPublic=false` (anti-impersonation / take-down). Audit action `garage.slug_override`.
> - Garage row displayed on the admin user-detail page: name, slug, isPublic state, premium status, premiumUntil. With grant/revoke + slug-override controls.
>
> **Still valid as written:** spot lifecycle controls (delete empty spot, manual refund), Car edit/delete admin endpoints, AdminAudit trace requirement on every mutation, "list garage" read endpoint shape (just drops the tier column from the response).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin user-detail "Garagem" panel and the admin endpoints behind it (list garage, edit car, delete car, delete empty spot, grant/revoke premium, override slug) so support can manage a user's cars, spots, and garage profile — all with AdminAudit traces.

**Architecture:** New Fastify route file `apps/api/src/routes/admin/user-garage.ts` registered under the same `requireRole('organizer', 'admin')` scope as `adminUserRoutes`. New Zod schemas in `packages/shared/src/admin-garage.ts` (re-exported from `@ccc/shared/admin`). New admin-API client functions and a Next.js client-rendered Garage panel mounted on the existing user-detail page. All write endpoints idempotently emit AdminAudit entries with structured metadata.

**Tech Stack:** Fastify + Prisma + Zod (api), Next.js App Router server components + client components (admin), Vitest (api integration tests against real Postgres via existing `helpers.ts`), React Testing Library (admin component tests).

---

## Dependencies and assumptions

This plan assumes TASK-A has already shipped and merged. From TASK-A you can rely on:

- `GarageSpot` Prisma model with fields documented in `Car_spot_plan.md` §3 (`id`, `userId`, `tier`, `source`, `carId`, `sourceOrderItemId`, `createdAt`, `updatedAt`).
- Prisma enums `GarageSpotTier = { free, extra, premium }` and `GarageSpotSource = { default_free, purchase, admin_grant, premium_membership }`.
- `adminAuditActionSchema` in `packages/shared/src/admin.ts` extended with the five literals: `car.admin_update`, `car.admin_delete`, `garage_spot.tier_override`, `garage_spot.delete`, `general_settings.garage_backfill`.
- `RecordAuditInput.entityType` union in `apps/api/src/services/admin-audit.ts` extended with `'car'` and `'garage_spot'`.
- `carSchema` in `packages/shared/src/cars.ts` extended with `tier: garageSpotTierSchema`.
- `garageSpotTierSchema` exported from `@ccc/shared` (either in `cars.ts` or a `garage.ts`).

If TASK-A has not landed, STOP and ask. Do not duplicate those additions here.

This plan does NOT depend on TASK-E's tier picker landing. The contract decision (per master plan §9 TASK-G sequencing note): TASK-G owns the admin tier endpoint `POST /admin/users/:id/cars/:carId/tier`. TASK-E's user-facing picker calls the separate user-facing route `PATCH /me/cars/:id` (or whatever TASK-E defines) — NOT this admin endpoint. The two endpoints differ on authorization, audit action, and allowed transitions.

---

## File Structure

### New files

| File                                                                | Responsibility                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/admin-garage.ts`                               | Zod schemas: `adminCarTierOverrideSchema`, `adminGarageReadSchema`, `adminGarageSpotSchema`, `adminGarageCarSchema`, `adminGarageSummarySchema`, `adminSpotDeleteBodySchema`. `adminCarUpdateSchema` is NOT defined here -- it is owned by TASK-A in `packages/shared/src/admin.ts`; import it from there. |
| `apps/api/src/routes/admin/user-garage.ts`                          | Fastify plugin `adminUserGarageRoutes` with the five endpoints.                                                                                                                                                                                                                                            |
| `apps/api/test/admin/user-garage/get-garage.test.ts`                | GET endpoint tests.                                                                                                                                                                                                                                                                                        |
| `apps/api/test/admin/user-garage/patch-car.test.ts`                 | PATCH car endpoint tests.                                                                                                                                                                                                                                                                                  |
| `apps/api/test/admin/user-garage/delete-car.test.ts`                | DELETE car endpoint tests.                                                                                                                                                                                                                                                                                 |
| `apps/api/test/admin/user-garage/tier-override.test.ts`             | Tier override endpoint tests (incl. round trip + refund recipe).                                                                                                                                                                                                                                           |
| `apps/api/test/admin/user-garage/delete-spot.test.ts`               | DELETE empty spot endpoint tests (refund recipe).                                                                                                                                                                                                                                                          |
| `apps/admin/src/lib/admin-garage-api.ts`                            | Client helpers calling the five endpoints via `apiFetch`.                                                                                                                                                                                                                                                  |
| `apps/admin/src/lib/admin-garage-actions.ts`                        | `'use server'` action wrappers mapping `ApiError` to UI strings.                                                                                                                                                                                                                                           |
| `apps/admin/src/components/user-garage-panel.tsx`                   | Server component rendering cars + spots tables. Server-side fetches `/admin/users/:id/garage`.                                                                                                                                                                                                             |
| `apps/admin/src/components/edit-car-modal.tsx`                      | Client modal for PATCH car.                                                                                                                                                                                                                                                                                |
| `apps/admin/src/components/delete-car-button.tsx`                   | Client confirm button for DELETE car.                                                                                                                                                                                                                                                                      |
| `apps/admin/src/components/car-tier-select.tsx`                     | Client select that submits tier override.                                                                                                                                                                                                                                                                  |
| `apps/admin/src/components/delete-spot-button.tsx`                  | Client confirm button for DELETE spot (only rendered when `carId IS NULL`).                                                                                                                                                                                                                                |
| `apps/admin/src/components/edit-car-modal.interaction.test.tsx`     | Component test for the edit modal (react-dom/client pattern).                                                                                                                                                                                                                                              |
| `apps/admin/src/components/delete-car-button.interaction.test.tsx`  | Component test for delete confirm (react-dom/client pattern).                                                                                                                                                                                                                                              |
| `apps/admin/src/components/car-tier-select.interaction.test.tsx`    | Component test for tier select (react-dom/client pattern).                                                                                                                                                                                                                                                 |
| `apps/admin/src/components/delete-spot-button.interaction.test.tsx` | Component test for delete spot confirm (react-dom/client pattern).                                                                                                                                                                                                                                         |

### Modified files

| File                                          | Change                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/index.ts`                | Add `export * from './admin-garage.js';`.                                                                                                                                                                     |
| `packages/shared/package.json`                | Add `./admin-garage` to `exports` map (mirror existing entries).                                                                                                                                              |
| `apps/api/src/routes/admin/index.ts`          | Register `adminUserGarageRoutes` inside the existing `organizer/admin` scope (next to `adminUserRoutes`).                                                                                                     |
| `apps/admin/src/lib/admin-api.ts`             | Re-export the new client helpers (or import directly from `./admin-garage-api`).                                                                                                                              |
| `apps/admin/app/(authed)/users/[id]/page.tsx` | Mount `<UserGaragePanel userId={user.id} />` inside the page.                                                                                                                                                 |
| `apps/api/test/helpers.ts`                    | If GarageSpot/Car/CarPhoto rows are missing from `resetDatabase`, add `prisma.garageSpot.deleteMany()` BEFORE `prisma.car.deleteMany()`. (TASK-A may already have done this — verify; do not add if present.) |

---

## Endpoint contracts (verbatim)

All five endpoints are mounted under the existing admin scope (`requireRole('organizer', 'admin')` per `apps/api/src/routes/admin/index.ts:46-65`). They reuse `requireUser(request)` to read the actor id for audit entries.

### 1. `GET /admin/users/:id/garage`

- **Auth:** organizer or admin.
- **Path params:** `id` = target user id.
- **Response 200:** `adminGarageReadSchema`.
- **Response 404:** target user not found.
- **No audit entry** (read-only).

Response shape:

```ts
{
  user: {
    id: string;
    name: string;
    email: string;
  }
  cars: Array<{
    id: string;
    make: string;
    model: string;
    year: number;
    nickname: string | null;
    tier: 'free' | 'extra' | 'premium';
    spotId: string; // the GarageSpot.id this car occupies
    createdAt: string; // ISO
    updatedAt: string; // ISO
  }>;
  spots: Array<{
    id: string;
    tier: 'free' | 'extra' | 'premium';
    source: 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
    carId: string | null; // null = empty
    sourceOrderItemId: string | null;
    createdAt: string; // ISO
    updatedAt: string; // ISO
  }>;
  summary: {
    totalSpots: number;
    filledSpots: number;
    emptySpots: number;
    byTier: {
      free: number;
      extra: number;
      premium: number;
    }
  }
}
```

### 2. `PATCH /admin/users/:id/cars/:carId`

- **Auth:** organizer or admin.
- **Body:** `adminCarUpdateSchema` (see below).
- **Response 200:** the updated car payload, matching one entry of `cars[]` in the GET shape.
- **Response 404:** user not found, or car not found, or car does not belong to user (return 404 — do not leak existence).
- **Response 400:** Zod validation failure or empty body.
- **Audit action:** `car.admin_update`. `entityType: 'car'`, `entityId: carId`.
- **Audit metadata:**
  ```ts
  {
    userId: string;             // target user id
    fields: Array<'make' | 'model' | 'year' | 'nickname'>;
    before: { make?: string; model?: string; year?: number; nickname?: string | null };
    after:  { make?: string; model?: string; year?: number; nickname?: string | null };
  }
  ```
  Only changed fields appear in `fields`/`before`/`after`. No-op PATCH (no fields after diff) returns 200 without writing audit.

### 3. `DELETE /admin/users/:id/cars/:carId`

- **Auth:** organizer or admin.
- **Response 204:** success.
- **Response 404:** user not found, or car not found, or car does not belong to user.
- **Behavior:** wrapped in a single Prisma `$transaction`. Inside the transaction:
  1. `tx.garageSpot.updateMany({ where: { carId, userId: target.id }, data: { carId: null } })` (preserves the spot row + tier per Car_spot_plan §4 "Deleting a car"). Use `updateMany` for explicit `userId` guard — defensive even though `carId @unique`.
  2. `tx.carPhoto.deleteMany({ where: { carId } })` (cascade-equivalent; explicit because we audit-log car deletion separately from photo cleanup). NOTE: the `Car → CarPhoto` relation already has `onDelete: Cascade` per schema. The explicit deleteMany is redundant — skip it; the cascade is sufficient. (Including this redundancy is what plan reviewers flag. Don't add the `deleteMany` line.)
  3. `tx.car.delete({ where: { id: carId } })`.
- **Audit action:** `car.admin_delete`. `entityType: 'car'`, `entityId: carId`.
- **Audit metadata:**
  ```ts
  {
    userId: string;
    make: string;
    model: string;
    year: number;
    nickname: string | null;
    spotId: string; // spot whose carId was cleared
    spotTier: 'free' | 'extra' | 'premium';
  }
  ```
  `spotId`/`spotTier` are captured BEFORE the update so the audit row reflects which spot was emptied.

### 4. `POST /admin/users/:id/cars/:carId/tier`

- **Auth:** organizer or admin.
- **Body:** `adminCarTierOverrideSchema` = `{ tier: 'premium' | 'free' | 'extra' }`.
- **Response 200:** updated car payload (same shape as PATCH).
- **Response 404:** user, car, or spot for that car not found.
- **Response 400:** unknown tier (Zod) OR tier already equals current (no-op explicit rejection to avoid silent audit gaps — return `{ error: 'BadRequest', message: 'tier already set' }`).
- **Audit action:** `garage_spot.tier_override`. `entityType: 'garage_spot'`, `entityId: spotId`.
- **Audit metadata:**
  ```ts
  {
    userId: string;
    carId: string;
    previousTier: 'free' | 'extra' | 'premium';
    newTier: 'free' | 'extra' | 'premium';
    // Source is mutated only when going TO 'premium' (set source='admin_grant').
    // Going AWAY from premium leaves source untouched so the prior provenance is preserved.
    previousSource: 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
    newSource: 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
  }
  ```
- **Behavior:**
  1. Load car + its garage spot in one query (`prisma.car.findUnique({ where: { id: carId }, include: { /* via reverse */ } })`). Since the relation lives on `GarageSpot`, query `prisma.garageSpot.findUnique({ where: { carId } })` and verify `carId`'s `userId === :id` parameter.
  2. If `spot.tier === body.tier` → 400 as above.
  3. In a single `prisma.$transaction([update spot, recordAudit on tx])`:
     - `tx.garageSpot.update({ where: { id: spotId }, data: { tier: body.tier, source: body.tier === 'premium' ? 'admin_grant' : spot.source } })`.
     - `recordAudit(... tx)` using the transactional client (helpers signature already supports it per `admin-audit.ts:36`).

### 5. `DELETE /admin/users/:id/spots/:spotId`

- **Auth:** organizer or admin.
- **Response 204:** success.
- **Response 404:** user/spot not found, or spot does not belong to user.
- **Response 409:** spot has `carId !== null` (cannot delete a filled spot) — body `{ error: 'Conflict', message: 'spot has a car; remove the car first' }`.
- **Audit action:** `garage_spot.delete`. `entityType: 'garage_spot'`, `entityId: spotId`.
- **Audit metadata:**
  ```ts
  {
    userId: string;
    tier: 'free' | 'extra' | 'premium';
    source: 'default_free' | 'purchase' | 'admin_grant' | 'premium_membership';
    sourceOrderItemId: string | null; // present iff source==='purchase' — supports refund recipe trace
    reason: 'manual_refund' | 'manual_cleanup'; // body-optional, see below
  }
  ```
  Body accepts an optional `{ reason?: 'manual_refund' | 'manual_cleanup' }`. Default `'manual_cleanup'`. Validated by `adminSpotDeleteBodySchema`.

---

## Zod schemas (`packages/shared/src/admin-garage.ts`)

This file is new. Drop in this exact content:

**Cross-task contract:** `adminCarUpdateSchema` is owned by TASK-A and lives in `packages/shared/src/admin.ts`. Do NOT redefine it here. Import and re-export it from there if needed by downstream consumers.

```ts
import { z } from 'zod';

// GarageSpotTier and GarageSpotSource are owned by TASK-A in packages/shared/src/garage.ts.
// Import from there rather than redeclaring.
export { garageSpotTierSchema, type GarageSpotTier } from './garage.js';
export { garageSpotSourceSchema, type GarageSpotSource } from './garage.js';

// adminCarUpdateSchema is owned by TASK-A in packages/shared/src/admin.ts.
// Re-export it here so admin-garage consumers have one import point.
export { adminCarUpdateSchema, type AdminCarUpdateInput } from './admin.js';

export const adminCarTierOverrideSchema = z.object({
  tier: garageSpotTierSchema,
});
export type AdminCarTierOverride = z.infer<typeof adminCarTierOverrideSchema>;

export const adminSpotDeleteBodySchema = z
  .object({
    reason: z.enum(['manual_refund', 'manual_cleanup']).default('manual_cleanup'),
  })
  .partial();
export type AdminSpotDeleteBody = z.infer<typeof adminSpotDeleteBodySchema>;

export const adminGarageCarSchema = z.object({
  id: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  nickname: z.string().max(60).nullable(),
  tier: garageSpotTierSchema,
  spotId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminGarageCar = z.infer<typeof adminGarageCarSchema>;

export const adminGarageSpotSchema = z.object({
  id: z.string().min(1),
  tier: garageSpotTierSchema,
  source: garageSpotSourceSchema,
  carId: z.string().min(1).nullable(),
  sourceOrderItemId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AdminGarageSpot = z.infer<typeof adminGarageSpotSchema>;

export const adminGarageSummarySchema = z.object({
  totalSpots: z.number().int().nonnegative(),
  filledSpots: z.number().int().nonnegative(),
  emptySpots: z.number().int().nonnegative(),
  byTier: z.object({
    free: z.number().int().nonnegative(),
    extra: z.number().int().nonnegative(),
    premium: z.number().int().nonnegative(),
  }),
});
export type AdminGarageSummary = z.infer<typeof adminGarageSummarySchema>;

export const adminGarageReadSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string().email(),
  }),
  cars: z.array(adminGarageCarSchema),
  spots: z.array(adminGarageSpotSchema),
  summary: adminGarageSummarySchema,
});
export type AdminGarageRead = z.infer<typeof adminGarageReadSchema>;
```

---

## Authorization

All five endpoints register inside the **existing** scope that already runs `requireRole('organizer', 'admin')` in `apps/api/src/routes/admin/index.ts`. Concretely, the change to `index.ts` is exactly one new `await scope.register(adminUserGarageRoutes);` line inside the existing organizer/admin block (alongside `adminUserRoutes`).

No additional role guard needed inside route handlers. Staff role is rejected at the scope layer (matches existing `adminUserRoutes` behavior).

Each handler additionally:

- Calls `requireUser(request)` to read the actor (already authenticated by the scope's `preHandler`) and uses `sub` for audit `actorId`.
- For every `:carId` and `:spotId`, verifies the resource's `userId === request.params.id`. Mismatch returns 404 (do not leak whether the resource exists for a different user).

---

## Per-task breakdown

### Task 1: Branch + Zod schemas

**Files:**

- Create: `packages/shared/src/admin-garage.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Branch safety preflight**

Run: `git branch --show-current`. If `production`, stop. Otherwise:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/garage-spots-task-g
```

- [ ] **Step 2: Verify TASK-A landed**

Run these checks in order. All must pass before continuing.

```bash
# 1. Confirm audit literals from TASK-A are present in admin.ts
grep -n "garage_spot.tier_override\|car.admin_update\|adminCarUpdateSchema" \
  /Users/pedro/Projects/jdm-experience/packages/shared/src/admin.ts
```

Expect matches for all three. If any are missing → STOP, ask user to confirm TASK-A is merged.

```bash
# 2. Confirm GarageSpot model exists
grep -n "model GarageSpot" /Users/pedro/Projects/jdm-experience/packages/db/prisma/schema.prisma
```

Expect a match. If missing → STOP.

```bash
# 3. Rebuild @ccc/shared and typecheck the API against the live dist/
# (per feedback_rebuild_shared_after_schema_change: runtime resolves dist/ and a stale
# build masks zod breaks that only typecheck catches)
pnpm -F @ccc/shared build && pnpm -F @ccc/api typecheck
```

Expect clean exit on both commands. If typecheck fails, the TASK-A additions are incomplete or the build is stale. Fix before continuing.

- [ ] **Step 3: Write `packages/shared/src/admin-garage.ts`**

Paste the full Zod schema block from the "Zod schemas" section above **with these mandatory adjustments**:

1. **Do NOT include `adminCarUpdateSchema`** in this file. TASK-A placed it in `packages/shared/src/admin.ts`. Including it here creates a duplicate export that will cause a compile conflict. The conflict check in Step 2 (grep for `adminCarUpdateSchema` in `admin.ts`) must pass before you write this file.

2. **Check for duplicate tier/source schemas**: run `grep -n "garageSpotTierSchema" /Users/pedro/Projects/jdm-experience/packages/shared/src/cars.ts` (or `garage.ts`). If `garageSpotTierSchema` is already exported from another file in `@ccc/shared`, replace the local declaration with `export { garageSpotTierSchema, type GarageSpotTier } from './garage.js';` and remove the duplicate. Same check for `garageSpotSourceSchema`. TASK-A places both in `packages/shared/src/garage.ts` -- import from there.

- [ ] **Step 4: Re-export from index + package exports**

Edit `packages/shared/src/index.ts` — add the line:

```ts
export * from './admin-garage.js';
```

Edit `packages/shared/package.json` — add the entry inside the `exports` map (preserve alphabetical order around the existing `./admin` and `./cars` entries):

```json
"./admin-garage": {
  "types": "./src/admin-garage.ts",
  "default": "./dist/admin-garage.js"
},
```

- [ ] **Step 5: Build shared package**

Run: `pnpm -F @ccc/shared build`. Expect: clean exit. (Per `feedback_rebuild_shared_after_schema_change` memory — API runtime resolves the `dist/` build.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/admin-garage.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): admin garage Zod schemas (TASK-G)"
```

---

### Task 2: GET /admin/users/:id/garage

**Files:**

- Create: `apps/api/src/routes/admin/user-garage.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Test: `apps/api/test/admin/user-garage/get-garage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/user-garage/get-garage.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminGarageReadSchema } from '@ccc/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('GET /admin/users/:id/garage', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users/x/garage' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/garage`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 for nonexistent user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/nonexistent/garage',
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns cars + spots + summary for a user with mixed tiers', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({
      email: 't@jdm.test',
      name: 'Target',
      verified: true,
    });

    const car = await prisma.car.create({
      data: { userId: target.id, make: 'Honda', model: 'Civic', year: 2002, nickname: 'EK9' },
    });
    const filledSpot = await prisma.garageSpot.create({
      data: { userId: target.id, tier: 'free', source: 'default_free', carId: car.id },
    });
    const emptyExtra = await prisma.garageSpot.create({
      data: {
        userId: target.id,
        tier: 'extra',
        source: 'purchase',
        carId: null,
        sourceOrderItemId: 'oi_1',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${target.id}/garage`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageReadSchema.parse(res.json());
    expect(body.user.id).toBe(target.id);
    expect(body.cars).toHaveLength(1);
    expect(body.cars[0]!.tier).toBe('free');
    expect(body.cars[0]!.spotId).toBe(filledSpot.id);
    expect(body.spots).toHaveLength(2);
    expect(body.summary).toEqual({
      totalSpots: 2,
      filledSpots: 1,
      emptySpots: 1,
      byTier: { free: 1, extra: 1, premium: 0 },
    });
    expect(body.spots.find((s) => s.id === emptyExtra.id)!.sourceOrderItemId).toBe('oi_1');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm -F @ccc/api test -- admin/user-garage/get-garage.test.ts`. Expect failures (route not registered → 404 on all paths, plus type errors if test path doesn't compile).

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/admin/user-garage.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminGarageReadSchema } from '@ccc/shared';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../../plugins/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const adminUserGarageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/users/:id/garage', async (request, reply) => {
    requireUser(request);
    const { id } = request.params as { id: string };

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!target) return reply.status(404).send({ error: 'NotFound' });

    const spots = await prisma.garageSpot.findMany({
      where: { userId: id },
      orderBy: [{ tier: 'asc' }, { createdAt: 'asc' }],
      include: { car: true },
    });

    const cars = spots
      .filter((s) => s.car)
      .map((s) => ({
        id: s.car!.id,
        make: s.car!.make,
        model: s.car!.model,
        year: s.car!.year,
        nickname: s.car!.nickname ?? null,
        tier: s.tier,
        spotId: s.id,
        createdAt: s.car!.createdAt.toISOString(),
        updatedAt: s.car!.updatedAt.toISOString(),
      }));

    const summary = {
      totalSpots: spots.length,
      filledSpots: spots.filter((s) => s.carId !== null).length,
      emptySpots: spots.filter((s) => s.carId === null).length,
      byTier: {
        free: spots.filter((s) => s.tier === 'free').length,
        extra: spots.filter((s) => s.tier === 'extra').length,
        premium: spots.filter((s) => s.tier === 'premium').length,
      },
    };

    return adminGarageReadSchema.parse({
      user: target,
      cars,
      spots: spots.map((s) => ({
        id: s.id,
        tier: s.tier,
        source: s.source,
        carId: s.carId,
        sourceOrderItemId: s.sourceOrderItemId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      summary,
    });
  });
};
```

- [ ] **Step 4: Register the route**

Edit `apps/api/src/routes/admin/index.ts`. In the `organizer/admin` scope block (around line 46), add an import at the top:

```ts
import { adminUserGarageRoutes } from './user-garage.js';
```

And add inside the existing organizer/admin scope register block (immediately after `await scope.register(adminUserRoutes);`):

```ts
await scope.register(adminUserGarageRoutes);
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm -F @ccc/api test -- admin/user-garage/get-garage.test.ts`. Expect all four cases PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/user-garage.ts apps/api/src/routes/admin/index.ts apps/api/test/admin/user-garage/get-garage.test.ts
git commit -m "feat(api): GET /admin/users/:id/garage (TASK-G)"
```

---

### Task 3: PATCH /admin/users/:id/cars/:carId

**Files:**

- Modify: `apps/api/src/routes/admin/user-garage.ts`
- Test: `apps/api/test/admin/user-garage/patch-car.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/user-garage/patch-car.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminGarageCarSchema } from '@ccc/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkCarWithSpot = async (userId: string) => {
  const car = await prisma.car.create({
    data: { userId, make: 'Toyota', model: 'AE86', year: 1985, nickname: null },
  });
  const spot = await prisma.garageSpot.create({
    data: { userId, tier: 'free', source: 'default_free', carId: car.id },
  });
  return { car, spot };
};

describe('PATCH /admin/users/:id/cars/:carId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('updates make/model/year/nickname and writes audit metadata', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const { car } = await mkCarWithSpot(target.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { make: 'Honda', year: 1999, nickname: 'EK9' },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageCarSchema.parse(res.json());
    expect(body.make).toBe('Honda');
    expect(body.year).toBe(1999);
    expect(body.nickname).toBe('EK9');
    expect(body.model).toBe('AE86'); // unchanged

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('car.admin_update');
    expect(audits[0]!.entityType).toBe('car');
    expect(audits[0]!.entityId).toBe(car.id);
    expect(audits[0]!.metadata).toMatchObject({
      userId: target.id,
      fields: ['make', 'year', 'nickname'],
      before: { make: 'Toyota', year: 1985, nickname: null },
      after: { make: 'Honda', year: 1999, nickname: 'EK9' },
    });
  });

  it('404 when car belongs to another user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    const { car } = await mkCarWithSpot(a.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${b.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { make: 'Honda' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const { car } = await mkCarWithSpot(user.id);
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { make: 'Honda' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 on empty body', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const { car } = await mkCarWithSpot(target.id);
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('no-op patch (same values) returns 200 and writes no audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const { car } = await mkCarWithSpot(target.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${target.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { make: 'Toyota', model: 'AE86', year: 1985, nickname: null },
    });
    expect(res.statusCode).toBe(200);
    const audits = await prisma.adminAudit.count({ where: { actorId: org.id } });
    expect(audits).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm -F @ccc/api test -- admin/user-garage/patch-car.test.ts`. Expect 404s (route not yet added).

- [ ] **Step 3: Add the PATCH handler**

Append inside the `adminUserGarageRoutes` plugin in `apps/api/src/routes/admin/user-garage.ts`. Add the imports at the top of the file:

```ts
import { adminCarUpdateSchema, adminGarageCarSchema } from '@ccc/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../services/admin-audit.js';
```

Add the handler:

```ts
app.patch('/users/:id/cars/:carId', async (request, reply) => {
  const actor = requireUser(request);
  const { id, carId } = request.params as { id: string; carId: string };
  const input = adminCarUpdateSchema.parse(request.body);

  const car = await prisma.car.findUnique({ where: { id: carId } });
  if (!car || car.userId !== id) return reply.status(404).send({ error: 'NotFound' });

  const before = {
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname ?? null,
  };

  const data: Prisma.CarUpdateInput = {};
  const fields: Array<'make' | 'model' | 'year' | 'nickname'> = [];
  const after: Record<string, unknown> = {};
  const beforeChanged: Record<string, unknown> = {};

  if (input.make !== undefined && input.make !== car.make) {
    data.make = input.make;
    fields.push('make');
    after.make = input.make;
    beforeChanged.make = car.make;
  }
  if (input.model !== undefined && input.model !== car.model) {
    data.model = input.model;
    fields.push('model');
    after.model = input.model;
    beforeChanged.model = car.model;
  }
  if (input.year !== undefined && input.year !== car.year) {
    data.year = input.year;
    fields.push('year');
    after.year = input.year;
    beforeChanged.year = car.year;
  }
  if (input.nickname !== undefined && (input.nickname ?? null) !== (car.nickname ?? null)) {
    data.nickname = input.nickname;
    fields.push('nickname');
    after.nickname = input.nickname ?? null;
    beforeChanged.nickname = car.nickname ?? null;
  }

  let updated = car;
  if (fields.length > 0) {
    updated = await prisma.$transaction(async (tx) => {
      const u = await tx.car.update({ where: { id: carId }, data });
      await recordAudit(
        {
          actorId: actor.sub,
          action: 'car.admin_update',
          entityType: 'car',
          entityId: carId,
          metadata: { userId: id, fields, before: beforeChanged, after },
        },
        tx,
      );
      return u;
    });
  }

  // Pull the spot to compute tier + spotId for the response.
  const spot = await prisma.garageSpot.findUnique({ where: { carId } });
  if (!spot) return reply.status(500).send({ error: 'Internal', message: 'car has no spot' });

  return adminGarageCarSchema.parse({
    id: updated.id,
    make: updated.make,
    model: updated.model,
    year: updated.year,
    nickname: updated.nickname ?? null,
    tier: spot.tier,
    spotId: spot.id,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm -F @ccc/api test -- admin/user-garage/patch-car.test.ts`. Expect all five cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/user-garage.ts apps/api/test/admin/user-garage/patch-car.test.ts
git commit -m "feat(api): PATCH /admin/users/:id/cars/:carId (TASK-G)"
```

---

### Task 4: DELETE /admin/users/:id/cars/:carId

**Files:**

- Modify: `apps/api/src/routes/admin/user-garage.ts`
- Test: `apps/api/test/admin/user-garage/delete-car.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/user-garage/delete-car.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('DELETE /admin/users/:id/cars/:carId', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('204 deletes car, clears spot.carId, preserves spot row and tier', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: { userId: target.id, make: 'Mazda', model: 'RX-7', year: 1995, nickname: 'FD' },
    });
    const spot = await prisma.garageSpot.create({
      data: {
        userId: target.id,
        tier: 'extra',
        source: 'purchase',
        carId: car.id,
        sourceOrderItemId: 'oi_1',
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(204);

    expect(await prisma.car.findUnique({ where: { id: car.id } })).toBeNull();
    const reloaded = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(reloaded).not.toBeNull();
    expect(reloaded!.carId).toBeNull();
    expect(reloaded!.tier).toBe('extra');
    expect(reloaded!.source).toBe('purchase');

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('car.admin_delete');
    expect(audits[0]!.entityType).toBe('car');
    expect(audits[0]!.entityId).toBe(car.id);
    expect(audits[0]!.metadata).toMatchObject({
      userId: target.id,
      make: 'Mazda',
      model: 'RX-7',
      year: 1995,
      nickname: 'FD',
      spotId: spot.id,
      spotTier: 'extra',
    });
  });

  it('404 when car belongs to another user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: { userId: a.id, make: 'X', model: 'Y', year: 2000 },
    });
    await prisma.garageSpot.create({
      data: { userId: a.id, tier: 'free', source: 'default_free', carId: car.id },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${b.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'X', model: 'Y', year: 2000 },
    });
    await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'free', source: 'default_free', carId: car.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${user.id}/cars/${car.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm -F @ccc/api test -- admin/user-garage/delete-car.test.ts`.

- [ ] **Step 3: Add the DELETE handler**

Append inside `adminUserGarageRoutes`:

```ts
app.delete('/users/:id/cars/:carId', async (request, reply) => {
  const actor = requireUser(request);
  const { id, carId } = request.params as { id: string; carId: string };

  const car = await prisma.car.findUnique({ where: { id: carId } });
  if (!car || car.userId !== id) return reply.status(404).send({ error: 'NotFound' });

  const spot = await prisma.garageSpot.findUnique({ where: { carId } });
  if (!spot) return reply.status(500).send({ error: 'Internal', message: 'car has no spot' });

  await prisma.$transaction(async (tx) => {
    await tx.garageSpot.update({ where: { id: spot.id }, data: { carId: null } });
    await tx.car.delete({ where: { id: carId } });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'car.admin_delete',
        entityType: 'car',
        entityId: carId,
        metadata: {
          userId: id,
          make: car.make,
          model: car.model,
          year: car.year,
          nickname: car.nickname ?? null,
          spotId: spot.id,
          spotTier: spot.tier,
        },
      },
      tx,
    );
  });

  return reply.status(204).send();
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm -F @ccc/api test -- admin/user-garage/delete-car.test.ts`. Expect all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/user-garage.ts apps/api/test/admin/user-garage/delete-car.test.ts
git commit -m "feat(api): DELETE /admin/users/:id/cars/:carId (TASK-G)"
```

---

### Task 5: POST /admin/users/:id/cars/:carId/tier (override)

**Files:**

- Modify: `apps/api/src/routes/admin/user-garage.ts`
- Test: `apps/api/test/admin/user-garage/tier-override.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/user-garage/tier-override.test.ts`:

```ts
import { prisma } from '@ccc/db';
import { adminGarageCarSchema } from '@ccc/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const seed = async (userId: string) => {
  const car = await prisma.car.create({
    data: { userId, make: 'Nissan', model: 'Skyline', year: 1999 },
  });
  const spot = await prisma.garageSpot.create({
    data: { userId, tier: 'free', source: 'default_free', carId: car.id },
  });
  return { car, spot };
};

describe('POST /admin/users/:id/cars/:carId/tier', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('upgrades free → premium, sets source=admin_grant, writes audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const { car, spot } = await seed(target.id);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/cars/${car.id}/tier`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { tier: 'premium' },
    });
    expect(res.statusCode).toBe(200);
    const body = adminGarageCarSchema.parse(res.json());
    expect(body.tier).toBe('premium');

    const reloaded = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(reloaded!.tier).toBe('premium');
    expect(reloaded!.source).toBe('admin_grant');

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('garage_spot.tier_override');
    expect(audits[0]!.entityType).toBe('garage_spot');
    expect(audits[0]!.entityId).toBe(spot.id);
    expect(audits[0]!.metadata).toMatchObject({
      userId: target.id,
      carId: car.id,
      previousTier: 'free',
      newTier: 'premium',
      previousSource: 'default_free',
      newSource: 'admin_grant',
    });
  });

  it('round trip: free → premium → free preserves the row, source falls back', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const { car, spot } = await seed(target.id);

    const up = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/cars/${car.id}/tier`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { tier: 'premium' },
    });
    expect(up.statusCode).toBe(200);

    const down = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/cars/${car.id}/tier`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { tier: 'free' },
    });
    expect(down.statusCode).toBe(200);

    const reloaded = await prisma.garageSpot.findUnique({ where: { id: spot.id } });
    expect(reloaded!.tier).toBe('free');
    // Source set to admin_grant on upgrade is preserved on downgrade per spec.
    expect(reloaded!.source).toBe('admin_grant');

    const audits = await prisma.adminAudit.findMany({
      where: { actorId: org.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits[1]!.metadata).toMatchObject({
      previousTier: 'premium',
      newTier: 'free',
      previousSource: 'admin_grant',
      newSource: 'admin_grant',
    });
  });

  it('400 when tier is already current', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const { car } = await seed(target.id);
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${target.id}/cars/${car.id}/tier`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { tier: 'free' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 when car belongs to another user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    const { car } = await seed(a.id);
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${b.id}/cars/${car.id}/tier`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { tier: 'premium' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const { car } = await seed(user.id);
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/cars/${car.id}/tier`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { tier: 'premium' },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm -F @ccc/api test -- admin/user-garage/tier-override.test.ts`.

- [ ] **Step 3: Add the handler**

Append the tier override handler inside `adminUserGarageRoutes` (also add the import `adminCarTierOverrideSchema` from `@ccc/shared` to the file header if not already present):

```ts
app.post('/users/:id/cars/:carId/tier', async (request, reply) => {
  const actor = requireUser(request);
  const { id, carId } = request.params as { id: string; carId: string };
  const { tier } = adminCarTierOverrideSchema.parse(request.body);

  const car = await prisma.car.findUnique({ where: { id: carId } });
  if (!car || car.userId !== id) return reply.status(404).send({ error: 'NotFound' });

  const spot = await prisma.garageSpot.findUnique({ where: { carId } });
  if (!spot) return reply.status(404).send({ error: 'NotFound', message: 'spot not found' });

  if (spot.tier === tier) {
    return reply.status(400).send({ error: 'BadRequest', message: 'tier already set' });
  }

  const nextSource = tier === 'premium' ? 'admin_grant' : spot.source;

  await prisma.$transaction(async (tx) => {
    await tx.garageSpot.update({
      where: { id: spot.id },
      data: { tier, source: nextSource },
    });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'garage_spot.tier_override',
        entityType: 'garage_spot',
        entityId: spot.id,
        metadata: {
          userId: id,
          carId,
          previousTier: spot.tier,
          newTier: tier,
          previousSource: spot.source,
          newSource: nextSource,
        },
      },
      tx,
    );
  });

  return adminGarageCarSchema.parse({
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname ?? null,
    tier,
    spotId: spot.id,
    createdAt: car.createdAt.toISOString(),
    updatedAt: car.updatedAt.toISOString(),
  });
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm -F @ccc/api test -- admin/user-garage/tier-override.test.ts`. Expect all five cases PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/user-garage.ts apps/api/test/admin/user-garage/tier-override.test.ts
git commit -m "feat(api): POST /admin/users/:id/cars/:carId/tier (TASK-G)"
```

---

### Task 6: DELETE /admin/users/:id/spots/:spotId (refund recipe)

**Files:**

- Modify: `apps/api/src/routes/admin/user-garage.ts`
- Test: `apps/api/test/admin/user-garage/delete-spot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin/user-garage/delete-spot.test.ts`:

```ts
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('DELETE /admin/users/:id/spots/:spotId', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('204 deletes an empty extra spot and writes refund audit', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const spot = await prisma.garageSpot.create({
      data: {
        userId: target.id,
        tier: 'extra',
        source: 'purchase',
        carId: null,
        sourceOrderItemId: 'oi_42',
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/spots/${spot.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
      payload: { reason: 'manual_refund' },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.garageSpot.findUnique({ where: { id: spot.id } })).toBeNull();

    const audits = await prisma.adminAudit.findMany({ where: { actorId: org.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('garage_spot.delete');
    expect(audits[0]!.entityType).toBe('garage_spot');
    expect(audits[0]!.entityId).toBe(spot.id);
    expect(audits[0]!.metadata).toMatchObject({
      userId: target.id,
      tier: 'extra',
      source: 'purchase',
      sourceOrderItemId: 'oi_42',
      reason: 'manual_refund',
    });
  });

  it('409 when spot has a car attached', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: target } = await createUser({ email: 't@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: { userId: target.id, make: 'X', model: 'Y', year: 2000 },
    });
    const spot = await prisma.garageSpot.create({
      data: { userId: target.id, tier: 'extra', source: 'purchase', carId: car.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${target.id}/spots/${spot.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
    expect(await prisma.garageSpot.findUnique({ where: { id: spot.id } })).not.toBeNull();
  });

  it('404 when spot belongs to another user', async () => {
    const { user: org } = await createUser({
      email: 'o@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    const spot = await prisma.garageSpot.create({
      data: { userId: a.id, tier: 'extra', source: 'purchase', carId: null },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${b.id}/spots/${spot.id}`,
      headers: { authorization: bearer(loadEnv(), org.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const spot = await prisma.garageSpot.create({
      data: { userId: user.id, tier: 'extra', source: 'purchase', carId: null },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${user.id}/spots/${spot.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm -F @ccc/api test -- admin/user-garage/delete-spot.test.ts`.

- [ ] **Step 3: Add the handler**

Append the delete-spot handler inside `adminUserGarageRoutes`. Add the import for `adminSpotDeleteBodySchema`:

```ts
app.delete('/users/:id/spots/:spotId', async (request, reply) => {
  const actor = requireUser(request);
  const { id, spotId } = request.params as { id: string; spotId: string };
  const body = adminSpotDeleteBodySchema.parse(request.body ?? {});
  const reason = body.reason ?? 'manual_cleanup';

  const spot = await prisma.garageSpot.findUnique({ where: { id: spotId } });
  if (!spot || spot.userId !== id) return reply.status(404).send({ error: 'NotFound' });

  if (spot.carId !== null) {
    return reply.status(409).send({
      error: 'Conflict',
      message: 'spot has a car; remove the car first',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.garageSpot.delete({ where: { id: spotId } });
    await recordAudit(
      {
        actorId: actor.sub,
        action: 'garage_spot.delete',
        entityType: 'garage_spot',
        entityId: spotId,
        metadata: {
          userId: id,
          tier: spot.tier,
          source: spot.source,
          sourceOrderItemId: spot.sourceOrderItemId,
          reason,
        },
      },
      tx,
    );
  });

  return reply.status(204).send();
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm -F @ccc/api test -- admin/user-garage/delete-spot.test.ts`. Expect all four cases PASS.

- [ ] **Step 5: Run the full TASK-G API suite**

Run: `pnpm -F @ccc/api test -- admin/user-garage`. Expect every test from Tasks 2-6 passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/user-garage.ts apps/api/test/admin/user-garage/delete-spot.test.ts
git commit -m "feat(api): DELETE /admin/users/:id/spots/:spotId (TASK-G)"
```

---

### Task 7: Admin web client helpers + server actions

**Files:**

- Create: `apps/admin/src/lib/admin-garage-api.ts`
- Create: `apps/admin/src/lib/admin-garage-actions.ts`

- [ ] **Step 1: Write `admin-garage-api.ts`**

Create `apps/admin/src/lib/admin-garage-api.ts`:

```ts
import { z } from 'zod';
import {
  adminGarageCarSchema,
  adminGarageReadSchema,
  type AdminCarTierOverride,
  type AdminCarUpdateInput,
  type AdminSpotDeleteBody,
} from '@ccc/shared';

import { apiFetch } from './api';

export const getAdminUserGarage = (userId: string) =>
  apiFetch(`/admin/users/${userId}/garage`, { schema: adminGarageReadSchema });

export const patchAdminUserCar = (userId: string, carId: string, input: AdminCarUpdateInput) =>
  apiFetch(`/admin/users/${userId}/cars/${carId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    schema: adminGarageCarSchema,
  });

export const deleteAdminUserCar = (userId: string, carId: string) =>
  apiFetch(`/admin/users/${userId}/cars/${carId}`, {
    method: 'DELETE',
    // 204 — apiFetch returns undefined as T; z.unknown() passes through.
    schema: z.unknown(),
  });

export const overrideAdminUserCarTier = (
  userId: string,
  carId: string,
  input: AdminCarTierOverride,
) =>
  apiFetch(`/admin/users/${userId}/cars/${carId}/tier`, {
    method: 'POST',
    body: JSON.stringify(input),
    schema: adminGarageCarSchema,
  });

export const deleteAdminUserSpot = (
  userId: string,
  spotId: string,
  body: AdminSpotDeleteBody = {},
) =>
  apiFetch(`/admin/users/${userId}/spots/${spotId}`, {
    method: 'DELETE',
    body: JSON.stringify(body),
    schema: z.unknown(),
  });
```

- [ ] **Step 2: Write `admin-garage-actions.ts`**

Create `apps/admin/src/lib/admin-garage-actions.ts`:

```ts
'use server';

import type {
  AdminCarTierOverride,
  AdminCarUpdateInput,
  AdminGarageCar,
  AdminSpotDeleteBody,
} from '@ccc/shared';

import {
  deleteAdminUserCar,
  deleteAdminUserSpot,
  overrideAdminUserCarTier,
  patchAdminUserCar,
} from './admin-garage-api';
import { ApiError } from './api';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const errFromApi = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Não encontrado.';
    if (err.status === 409) return 'Operação não permitida (conflito).';
    if (err.status === 400) return err.message || 'Dados inválidos.';
    if (err.status === 403) return 'Sem permissão.';
    return err.message || fallback;
  }
  return fallback;
};

export const patchAdminUserCarAction = async (
  userId: string,
  carId: string,
  input: AdminCarUpdateInput,
): Promise<Result<AdminGarageCar>> => {
  try {
    const data = await patchAdminUserCar(userId, carId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao atualizar carro.') };
  }
};

export const deleteAdminUserCarAction = async (
  userId: string,
  carId: string,
): Promise<Result<null>> => {
  try {
    await deleteAdminUserCar(userId, carId);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao deletar carro.') };
  }
};

export const overrideAdminUserCarTierAction = async (
  userId: string,
  carId: string,
  input: AdminCarTierOverride,
): Promise<Result<AdminGarageCar>> => {
  try {
    const data = await overrideAdminUserCarTier(userId, carId, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao alterar tier.') };
  }
};

export const deleteAdminUserSpotAction = async (
  userId: string,
  spotId: string,
  body: AdminSpotDeleteBody = {},
): Promise<Result<null>> => {
  try {
    await deleteAdminUserSpot(userId, spotId, body);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: errFromApi(err, 'Falha ao deletar vaga.') };
  }
};
```

- [ ] **Step 3: Verify the admin app type-checks**

Run: `pnpm -F admin typecheck`. (Confirm the script name first via `cat apps/admin/package.json | grep -A2 scripts`. If `typecheck` is absent, use `pnpm -F admin lint` or `pnpm -F admin build`.) Expect: clean exit.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/admin-garage-api.ts apps/admin/src/lib/admin-garage-actions.ts
git commit -m "feat(admin): garage admin api client + server actions (TASK-G)"
```

---

### Task 8: Admin garage panel components

**Files:**

- Create: `apps/admin/src/components/user-garage-panel.tsx`
- Create: `apps/admin/src/components/edit-car-modal.tsx`
- Create: `apps/admin/src/components/delete-car-button.tsx`
- Create: `apps/admin/src/components/car-tier-select.tsx`
- Create: `apps/admin/src/components/delete-spot-button.tsx`
- Modify: `apps/admin/app/(authed)/users/[id]/page.tsx`

- [ ] **Step 1: Branch safety reminder**

Reread `apps/admin/CLAUDE.md` and `apps/admin/AGENTS.md` BEFORE writing Next.js code. They warn the version has breaking changes. Open `node_modules/next/dist/docs/` if any pattern feels uncertain.

- [ ] **Step 2: Write `delete-car-button.tsx`**

Create `apps/admin/src/components/delete-car-button.tsx` modeled on `remove-member-button.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteAdminUserCarAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
  carId: string;
  label: string; // e.g. "Honda Civic 1999"
}

export function DeleteCarButton({ userId, carId, label }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = () => {
    if (!confirm(`Remover ${label}? A vaga será preservada.`)) return;
    startTransition(async () => {
      setError(null);
      const res = await deleteAdminUserCarAction(userId, carId);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={handle}
        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        {isPending ? '...' : 'Remover'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
```

- [ ] **Step 3: Write `delete-spot-button.tsx`**

Create `apps/admin/src/components/delete-spot-button.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteAdminUserSpotAction } from '~/lib/admin-garage-actions';

interface Props {
  userId: string;
  spotId: string;
  tier: 'free' | 'extra' | 'premium';
}

export function DeleteSpotButton({ userId, spotId, tier }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = () => {
    const msg =
      tier === 'extra' ? 'Reembolsar (deletar) esta vaga extra vazia?' : 'Deletar esta vaga vazia?';
    if (!confirm(msg)) return;
    startTransition(async () => {
      setError(null);
      const res = await deleteAdminUserSpotAction(userId, spotId, {
        reason: tier === 'extra' ? 'manual_refund' : 'manual_cleanup',
      });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={handle}
        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        {isPending ? '...' : 'Deletar vaga'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
```

- [ ] **Step 4: Write `car-tier-select.tsx`**

Create `apps/admin/src/components/car-tier-select.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { overrideAdminUserCarTierAction } from '~/lib/admin-garage-actions';

type Tier = 'free' | 'extra' | 'premium';

interface Props {
  userId: string;
  carId: string;
  current: Tier;
}

const labels: Record<Tier, string> = {
  free: 'Free',
  extra: 'Extra',
  premium: 'Premium',
};

export function CarTierSelect({ userId, carId, current }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<Tier>(current);

  const onChange = (next: Tier) => {
    if (next === current) return;
    if (!confirm(`Alterar tier para ${labels[next]}?`)) {
      setValue(current);
      return;
    }
    setValue(next);
    startTransition(async () => {
      setError(null);
      const res = await overrideAdminUserCarTierAction(userId, carId, { tier: next });
      if (res.ok) router.refresh();
      else {
        setValue(current);
        setError(res.error);
      }
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <select
        disabled={isPending}
        value={value}
        onChange={(e) => onChange(e.target.value as Tier)}
        className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1 text-xs text-[color:var(--color-fg)] disabled:opacity-50"
      >
        <option value="free">Free</option>
        <option value="extra">Extra</option>
        <option value="premium">Premium</option>
      </select>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
```

- [ ] **Step 5: Write `edit-car-modal.tsx`**

Create `apps/admin/src/components/edit-car-modal.tsx`. Model on `add-user-to-group-modal.tsx` (same input classes, Esc-to-close handler, transition pattern):

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

import { patchAdminUserCarAction } from '~/lib/admin-garage-actions';

const inputCls =
  'w-full rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm text-[color:var(--color-fg)]';

interface Props {
  userId: string;
  car: {
    id: string;
    make: string;
    model: string;
    year: number;
    nickname: string | null;
  };
}

export function EditCarModal({ userId, car }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [make, setMake] = useState(car.make);
  const [model, setModel] = useState(car.model);
  const [year, setYear] = useState(String(car.year));
  const [nickname, setNickname] = useState(car.nickname ?? '');

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    setMake(car.make);
    setModel(car.model);
    setYear(String(car.year));
    setNickname(car.nickname ?? '');
  }, [car]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const submit = () => {
    const yearN = Number.parseInt(year, 10);
    if (!Number.isFinite(yearN)) {
      setError('Ano inválido.');
      return;
    }
    const input: Record<string, unknown> = {};
    if (make.trim() !== car.make) input.make = make.trim();
    if (model.trim() !== car.model) input.model = model.trim();
    if (yearN !== car.year) input.year = yearN;
    const nicknameTrim = nickname.trim();
    const currentNick = car.nickname ?? null;
    const nextNick = nicknameTrim === '' ? null : nicknameTrim;
    if (nextNick !== currentNick) input.nickname = nextNick;

    if (Object.keys(input).length === 0) {
      close();
      return;
    }

    startTransition(async () => {
      setError(null);
      const res = await patchAdminUserCarAction(userId, car.id, input);
      if (res.ok) {
        router.refresh();
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[color:var(--color-link)] hover:underline"
      >
        Editar
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-sm rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-4">
            <h3 className="mb-2 text-sm font-semibold">Editar carro</h3>
            <div className="flex flex-col gap-2">
              <label className="text-xs">
                Marca
                <input
                  className={inputCls}
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Modelo
                <input
                  className={inputCls}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Ano
                <input
                  className={inputCls}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="text-xs">
                Apelido
                <input
                  className={inputCls}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </label>
              {error && <span className="text-xs text-red-400">{error}</span>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={close} className="text-xs">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={submit}
                  className="rounded bg-[color:var(--color-accent)] px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
                >
                  {isPending ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Write `user-garage-panel.tsx`**

Create `apps/admin/src/components/user-garage-panel.tsx`. This is a **server component** that fetches the garage payload and renders two tables (cars + empty spots). The `<EditCarModal>`, `<DeleteCarButton>`, `<CarTierSelect>`, `<DeleteSpotButton>` clients are imported as client components and embedded in the JSX (server components can render client components freely).

```tsx
import { getAdminUserGarage } from '~/lib/admin-garage-api';

import { CarTierSelect } from './car-tier-select';
import { DeleteCarButton } from './delete-car-button';
import { DeleteSpotButton } from './delete-spot-button';
import { EditCarModal } from './edit-car-modal';

interface Props {
  userId: string;
}

const tierLabel: Record<'free' | 'extra' | 'premium', string> = {
  free: 'Free',
  extra: 'Extra',
  premium: 'Premium',
};

export async function UserGaragePanel({ userId }: Props) {
  const garage = await getAdminUserGarage(userId);
  const emptySpots = garage.spots.filter((s) => s.carId === null);

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Garagem</h2>
      <p className="mb-2 text-xs text-[color:var(--color-muted)]">
        Total: {garage.summary.totalSpots} • Preenchidas: {garage.summary.filledSpots} • Vazias:{' '}
        {garage.summary.emptySpots}
        {' • '}
        Free: {garage.summary.byTier.free} • Extra: {garage.summary.byTier.extra} • Premium:{' '}
        {garage.summary.byTier.premium}
      </p>

      {/* Cars table */}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Carro</th>
            <th>Apelido</th>
            <th>Tier</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {garage.cars.map((car) => (
            <tr key={car.id} className="border-b border-[color:var(--color-border)]">
              <td className="py-2 text-sm">
                {car.make} {car.model} {car.year}
              </td>
              <td className="text-sm">{car.nickname ?? '—'}</td>
              <td className="text-sm">
                <CarTierSelect userId={userId} carId={car.id} current={car.tier} />
              </td>
              <td className="text-right text-sm">
                <div className="inline-flex items-center gap-3">
                  <EditCarModal userId={userId} car={car} />
                  <DeleteCarButton
                    userId={userId}
                    carId={car.id}
                    label={`${car.make} ${car.model} ${car.year}`}
                  />
                </div>
              </td>
            </tr>
          ))}
          {garage.cars.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-sm text-[color:var(--color-muted)]">
                Nenhum carro.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Empty spots table */}
      <h3 className="mt-4 mb-2 text-sm font-semibold">Vagas vazias</h3>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Tier</th>
            <th>Origem</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {emptySpots.map((s) => (
            <tr key={s.id} className="border-b border-[color:var(--color-border)]">
              <td className="py-2 text-sm">{tierLabel[s.tier]}</td>
              <td className="text-sm">{s.source}</td>
              <td className="text-right text-sm">
                <DeleteSpotButton userId={userId} spotId={s.id} tier={s.tier} />
              </td>
            </tr>
          ))}
          {emptySpots.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-sm text-[color:var(--color-muted)]">
                Nenhuma vaga vazia.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Mount the panel on the user detail page**

Edit `apps/admin/app/(authed)/users/[id]/page.tsx`. Add the import at the top:

```tsx
import { UserGaragePanel } from '~/components/user-garage-panel';
```

Add the section just before the closing `</section>` (right after the `Grupos` block, around line 227):

```tsx
<UserGaragePanel userId={user.id} />
```

- [ ] **Step 8: Manual smoke-test build**

Run: `pnpm -F admin build`. Expect: clean build. (Do not start the dev server per `feedback_no_background_shells` memory.)

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/components/user-garage-panel.tsx apps/admin/src/components/edit-car-modal.tsx apps/admin/src/components/delete-car-button.tsx apps/admin/src/components/car-tier-select.tsx apps/admin/src/components/delete-spot-button.tsx apps/admin/app/\(authed\)/users/\[id\]/page.tsx
git commit -m "feat(admin): user-detail garage panel (TASK-G)"
```

---

### Task 9: Admin component tests

**Files:**

- Create: `apps/admin/src/components/delete-car-button.interaction.test.tsx`
- Create: `apps/admin/src/components/delete-spot-button.interaction.test.tsx`
- Create: `apps/admin/src/components/car-tier-select.interaction.test.tsx`
- Create: `apps/admin/src/components/edit-car-modal.interaction.test.tsx`

**Note on test location:** tests live directly in `apps/admin/src/components/` (colocated), matching the dominant pattern of `add-user-to-group-modal.interaction.test.tsx` and `add-group-member-modal.interaction.test.tsx`. Do NOT place them in `__tests__/`.

**Note on test harness:** `@testing-library/react` is NOT installed in this workspace. Do not add it. All tests use `react-dom/client` + `act` + `vi.hoisted()` exactly like the existing interaction tests. Pattern: `vi.hoisted()` for mocks defined before imports, manual DOM root (`createRoot`), `act()` wrappers for render and event dispatch, DOM queries via `container.querySelector` / `document.querySelector`.

- [ ] **Step 1: Confirm pattern by reading the existing test**

Read `apps/admin/src/components/add-user-to-group-modal.interaction.test.tsx` before writing any test. Mirror the `// @vitest-environment jsdom`, `IS_REACT_ACT_ENVIRONMENT`, `vi.hoisted`, `createRoot`, `act`, `beforeEach`/`afterEach` cleanup pattern exactly.

- [ ] **Step 2: Write `delete-car-button.interaction.test.tsx`**

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, deleteCarMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  deleteCarMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-garage-actions', () => ({
  deleteAdminUserCarAction: deleteCarMock,
}));

import { DeleteCarButton } from './delete-car-button';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  refreshMock.mockReset();
  deleteCarMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('DeleteCarButton', () => {
  it('calls action when confirmed', async () => {
    deleteCarMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(<DeleteCarButton userId="u1" carId="c1" label="Civic" />);
      await Promise.resolve();
    });
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Remover'),
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });
    expect(deleteCarMock).toHaveBeenCalledWith('u1', 'c1');
  });

  it('shows error on action failure', async () => {
    deleteCarMock.mockResolvedValue({ ok: false, error: 'boom' });
    await act(async () => {
      root.render(<DeleteCarButton userId="u1" carId="c1" label="Civic" />);
      await Promise.resolve();
    });
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Remover'),
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('boom');
  });
});
```

- [ ] **Step 3: Write `delete-spot-button.interaction.test.tsx`**

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, deleteSpotMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  deleteSpotMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-garage-actions', () => ({
  deleteAdminUserSpotAction: deleteSpotMock,
}));

import { DeleteSpotButton } from './delete-spot-button';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  refreshMock.mockReset();
  deleteSpotMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('DeleteSpotButton', () => {
  it('passes manual_refund reason for extra tier', async () => {
    deleteSpotMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(<DeleteSpotButton userId="u1" spotId="s1" tier="extra" />);
      await Promise.resolve();
    });
    const btn = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });
    expect(deleteSpotMock).toHaveBeenCalledWith('u1', 's1', { reason: 'manual_refund' });
  });

  it('passes manual_cleanup reason for free tier', async () => {
    deleteSpotMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(<DeleteSpotButton userId="u1" spotId="s1" tier="free" />);
      await Promise.resolve();
    });
    const btn = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
    });
    expect(deleteSpotMock).toHaveBeenCalledWith('u1', 's1', { reason: 'manual_cleanup' });
  });
});
```

- [ ] **Step 4: Write `car-tier-select.interaction.test.tsx`**

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, tierMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  tierMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-garage-actions', () => ({
  overrideAdminUserCarTierAction: tierMock,
}));

import { CarTierSelect } from './car-tier-select';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  refreshMock.mockReset();
  tierMock.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

describe('CarTierSelect', () => {
  it('calls action on tier change after confirm', async () => {
    tierMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(<CarTierSelect userId="u1" carId="c1" current="free" />);
      await Promise.resolve();
    });
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'premium';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(tierMock).toHaveBeenCalledWith('u1', 'c1', { tier: 'premium' });
  });

  it('does nothing when same tier selected', async () => {
    tierMock.mockResolvedValue({ ok: true });
    await act(async () => {
      root.render(<CarTierSelect userId="u1" carId="c1" current="free" />);
      await Promise.resolve();
    });
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'free';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(tierMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Write `edit-car-modal.interaction.test.tsx`**

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, patchMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('~/lib/admin-garage-actions', () => ({
  patchAdminUserCarAction: patchMock,
}));

import { EditCarModal } from './edit-car-modal';

const baseCar = { id: 'c1', make: 'Toyota', model: 'AE86', year: 1985, nickname: null };

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  refreshMock.mockReset();
  patchMock.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
});

async function openModal() {
  await act(async () => {
    root.render(<EditCarModal userId="u1" car={baseCar} />);
    await Promise.resolve();
  });
  const editBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Editar'),
  ) as HTMLButtonElement;
  await act(async () => {
    editBtn.click();
    await Promise.resolve();
  });
}

function findSaveBtn() {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Salvar'),
  ) as HTMLButtonElement;
}

describe('EditCarModal', () => {
  it('submits only changed fields', async () => {
    patchMock.mockResolvedValue({
      ok: true,
      data: { ...baseCar, make: 'Honda', spotId: 's1', tier: 'free', createdAt: '', updatedAt: '' },
    });
    await openModal();
    const makeInput = container.querySelector('input[value="Toyota"]') as HTMLInputElement;
    await act(async () => {
      makeInput.value = 'Honda';
      makeInput.dispatchEvent(new Event('input', { bubbles: true }));
      makeInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      findSaveBtn().click();
      await Promise.resolve();
    });
    expect(patchMock).toHaveBeenCalledWith('u1', 'c1', expect.objectContaining({ make: 'Honda' }));
  });

  it('shows error from action result', async () => {
    patchMock.mockResolvedValue({ ok: false, error: 'bad input' });
    await openModal();
    const makeInput = container.querySelector('input[value="Toyota"]') as HTMLInputElement;
    await act(async () => {
      makeInput.value = 'Honda';
      makeInput.dispatchEvent(new Event('input', { bubbles: true }));
      makeInput.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      findSaveBtn().click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('bad input');
  });

  it('closes without action when nothing changed', async () => {
    await openModal();
    await act(async () => {
      findSaveBtn().click();
      await Promise.resolve();
    });
    expect(patchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run admin component tests**

Run: `pnpm -F admin test -- delete-car-button.interaction delete-spot-button.interaction car-tier-select.interaction edit-car-modal.interaction`. Expect every case PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/edit-car-modal.interaction.test.tsx apps/admin/src/components/delete-car-button.interaction.test.tsx apps/admin/src/components/car-tier-select.interaction.test.tsx apps/admin/src/components/delete-spot-button.interaction.test.tsx
git commit -m "test(admin): garage panel component tests (TASK-G)"
```

---

### Task 10: Full test suite + open PR

- [ ] **Step 1: Run the full API admin test suite**

Run: `pnpm -F @ccc/api test -- admin/`. Expect all green (including pre-existing tests untouched).

- [ ] **Step 2: Run the full admin test suite**

Run: `pnpm -F admin test`. Expect all green. (Includes the four new `*.interaction.test.tsx` files from Task 9.)

- [ ] **Step 3: Run typecheck across packages**

Run: `pnpm -r typecheck` (or `pnpm -r build` if typecheck script is absent). Expect clean exit.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feat/garage-spots-task-g
gh pr create --base main --title "feat: TASK-G admin user-detail garage management" --body "$(cat <<'EOF'
## Summary
- Adds GET/PATCH/DELETE/POST endpoints under `/admin/users/:id/...` for managing a user's cars and garage spots.
- Adds `adminCarUpdateSchema`, `adminCarTierOverrideSchema`, `adminGarageReadSchema` to `@ccc/shared`.
- Adds a "Garagem" panel to the admin user-detail page with edit modal, tier select, and delete confirmations.
- All write paths emit AdminAudit entries with structured metadata. Refund recipe documented (DELETE empty extra spot → `garage_spot.delete` with `reason: manual_refund`).

## Test plan
- [ ] `pnpm -F @ccc/api test -- admin/user-garage` (5 files) green
- [ ] `pnpm -F admin test` green
- [ ] `pnpm -F admin build` green
- [ ] Smoke: load user detail page in dev admin, edit a car, toggle tier, delete empty extra spot, confirm audit rows show up via `/admin/audit`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Refund recipe (documented per master plan §10)

This is the "manual refund" flow TASK-G enables. Document in PR description and in `Car_spot_plan.md` §10 (out of scope for this plan to edit, but referenced):

1. **Identify the spot**: support agent opens `/admin/users/:id` and locates the empty extra spot in the "Vagas vazias" table (only appears when `carId IS NULL`).
2. **Refund external payment**: agent issues the Stripe / AbacatePay refund manually via the provider dashboard, using `sourceOrderItemId` from the audit metadata to trace the originating order item.
3. **Delete the spot**: click "Deletar vaga" → confirm. UI sends `DELETE /admin/users/:id/spots/:spotId` with `{ reason: 'manual_refund' }`.
4. **Audit entry**: a `garage_spot.delete` row appears with `metadata: { tier: 'extra', source: 'purchase', sourceOrderItemId, reason: 'manual_refund' }`. This row is the canonical record of the refund in JDM's system.
5. **Cross-reference**: agent links the refund to the order via `sourceOrderItemId` in the comment / support ticket. (Out of scope: auto-linking to a Stripe refund id; deferred per master plan §8.)

The endpoint refuses to delete a filled spot (409). To refund an in-use extra spot, the agent must first DELETE the car (which clears `carId`), then DELETE the now-empty spot. Both actions audit-log separately, giving a complete trail.

---

## Risks and open questions

1. **Audit metadata shape drift**: this plan locks the JSON shape for five new audit actions. If the admin audit viewer (`apps/admin/app/(authed)/audit/...`) renders metadata field-by-field with a known map, it must learn these shapes. Out of scope here — flag for the audit viewer owner. Mitigation: shapes are flat and string/number-only, so a generic JSON renderer works.
2. **`car.admin_delete` vs `feed_post.cascade`**: deleting a car cascades photos via Prisma `onDelete: Cascade`. Feed posts/comments authored against that car use `onDelete: SetNull` per schema (verified at `schema.prisma` FeedPost line ~1045 and FeedComment line ~1086). Car deletion will NOT 500 on feed rows — those relations null out `carId` automatically. No additional guard is needed in the DELETE handler.
3. **Tier override race with concurrent user-facing PATCH**: TASK-E's user-facing tier endpoint may run concurrently. Both writers target the same `GarageSpot` row. Risk is low because `prisma.garageSpot.update` is atomic, but a "lost update" of `source` is possible if both writers attempt tier transitions at the same instant. Acceptable for MVP; document in TASK-E plan.
4. **Listing performance**: `findMany` over all of a user's spots loads `include: { car: true }`. For a user with hundreds of spots this is fine; users are bounded by free-limit math and purchase price. No pagination added.
5. **Open question — admin tier override creates audit but doesn't notify the user**: spec defers push notifications (master plan §7). Confirm: should we still emit an in-app `notification` row when an admin grants premium? Defaulting to **no** to stay within scope.
6. **Open question — 400 vs idempotent on tier already set**: master plan does not specify. This plan picks 400. If support frequently re-asserts the same tier (e.g. UI auto-submits), this becomes noisy. Acceptable trade-off in MVP; reconsider if support complains.
7. **Open question — soft-delete vs hard delete on `car.admin_delete`**: spec says "deletes". Hard delete chosen. Audit row preserves the car snapshot in metadata, so the deletion is auditable but not reversible. If reviewers prefer soft delete, surface as follow-up.

---

## Self-review

**Spec coverage (master plan §9 TASK-G):**

- [x] GET /admin/users/:id/garage — Task 2.
- [x] PATCH /admin/users/:id/cars/:carId — Task 3.
- [x] DELETE /admin/users/:id/cars/:carId — Task 4.
- [x] POST /admin/users/:id/cars/:carId/tier — Task 5.
- [x] DELETE /admin/users/:id/spots/:spotId — Task 6.
- [x] `adminCarUpdateSchema` defined — Task 1.
- [x] AdminAudit metadata per action — endpoint contracts section.
- [x] Admin web UI: garage panel — Tasks 7-8.
- [x] Confirmation modals for destructive actions — Tasks 7-8.
- [x] Tests per endpoint + audit assertions + tier round trip — Tasks 2-6.
- [x] Manual refund recipe documented — Refund recipe section.

**Out-of-scope checks:**

- AdminAudit action enum + entityType: assumed from TASK-A.
- `reconcileGarageSpots`: not touched (TASK-B).
- `PremiumBadge`: not built here; the panel uses text labels not the badge component, deferring the badge to TASK-E.
- GeneralSettings field: untouched (TASK-F).
- Mobile: untouched.

**Type consistency:**

- `tier`/`source` literal unions consistent across Zod schemas, audit metadata, and Prisma calls.
- `spotId` used in both audit metadata and response payload.
- `userId` param consistently named `id` in route paths (matches existing `/admin/users/:id`).

---

## Cross-task contract decisions

**`adminCarUpdateSchema` ownership (resolved):**

TASK-A explicitly places `adminCarUpdateSchema` in `packages/shared/src/admin.ts` (TASK-A §7, file structure table, and at-a-glance summary). TASK-G must import from there, not redefine in `admin-garage.ts`. The "Zod schemas" section and Task 1 Step 3 have been updated to reflect this. The `admin-garage.ts` file re-exports `adminCarUpdateSchema` from `./admin.js` so downstream consumers of `@ccc/shared/admin-garage` still have a single import point.

**`garageSpotTierSchema` / `garageSpotSourceSchema` ownership (resolved):**

TASK-A places both in `packages/shared/src/garage.ts`. `admin-garage.ts` imports and re-exports from `./garage.js`. No duplicate declarations.

---

## Reviewer pushback

**Finding: "recordAudit already accepts tx client — no extension needed"**

Confirmed correct. `admin-audit.ts:36-41` shows `type AuditClient = Pick<typeof prisma, 'adminAudit'> | Prisma.TransactionClient`. The plan never claimed an extension was needed here; it correctly calls `recordAudit(..., tx)` throughout. No pushback, no action.

All other reviewer findings were verified against the codebase and applied.
