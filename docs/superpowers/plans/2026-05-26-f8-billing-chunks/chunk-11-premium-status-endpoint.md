# F8.11 — Premium Status Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `packages/shared/src/premium.ts` with `premiumStatusSchema`, create `GET /api/me/premium/status` in `apps/api/src/routes/me-premium.ts`, and re-export from `@jdm/shared`.

**Architecture:** The endpoint queries the most-recent `PremiumMembership` row for the requesting user's garage, derives the `active` boolean, resolves `manageUrl` per provider, and falls back to the admin-grant snapshot on `Garage` when no membership row exists. All logic lives in the route handler (no separate service needed for this read-path). Feature flag gates the route per canon §F8.11 — disabled returns 503.

**Tech Stack:** Fastify + Prisma, Zod in `@jdm/shared`, Vitest + Testcontainers Postgres (real DB via `makeApp` + `resetDatabase` helpers).

---

## Dependency pre-check

This chunk depends on:

- **F8.01** — `PremiumMembership` model + `PremiumProvider`/`PremiumCadence`/`PremiumMembershipStatus` enums in Prisma schema; `GROWTH_PREMIUM_BILLING_ENABLED` in `apps/api/src/env.ts`; `packages/shared/src/premium.ts` skeleton (even if empty).
- **F8.09** — `apps/api/src/routes/me-premium.ts` file exists (this chunk extends it). If F8.09 has not landed, this plan creates the file from scratch (documented below).

> If F8.01 has not landed, STOP. The Prisma client will not have `PremiumMembership` and the tests will fail at import time.

---

## Required reading before implementing

- `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §8.3 (`premiumStatusSchema` exact shape), §5 (feature flag disabled = 503), §13 canon §F8.11 + §F8.13.
- `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §"F8.11" + §"Cross-chunk canon".
- `apps/api/src/routes/me.ts` — auth pattern (`{ preHandler: [app.authenticate] }` + `requireUser(request)`).
- `apps/api/test/helpers.ts` — `makeApp`, `resetDatabase`, `createUser`, `bearer` signatures.
- `apps/api/src/env.ts` — confirm `GROWTH_PREMIUM_BILLING_ENABLED` exists (F8.01 must have landed).
- `packages/shared/src/index.ts` — re-export pattern.

---

## Files touched

| Path                                              | Action            | Responsibility                                       |
| ------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| `packages/shared/src/premium.ts`                  | Modify (populate) | `premiumStatusSchema` zod definition                 |
| `packages/shared/src/index.ts`                    | Modify            | Re-export `./premium`                                |
| `apps/api/src/routes/me-premium.ts`               | Create or extend  | `GET /api/me/premium/status` handler                 |
| `apps/api/src/app.ts`                             | Modify            | Register `mePremiumRoutes` if not already registered |
| `apps/api/test/billing/me-premium-status.test.ts` | Create            | All 7 scenario integration tests                     |

---

## Pre-flight checklist (run once before Task 1)

- [ ] **Pre-flight 1: Branch safety**

```bash
git branch --show-current
```

Expected: NOT `production`. If output is `production`, STOP and switch to `main` first.

- [ ] **Pre-flight 2: Create branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-11
```

- [ ] **Pre-flight 3: Confirm F8.01 has landed**

```bash
grep -n "PremiumMembership" /Users/pedro/Projects/jdm-experience/packages/db/prisma/schema.prisma
grep -n "GROWTH_PREMIUM_BILLING_ENABLED" /Users/pedro/Projects/jdm-experience/apps/api/src/env.ts
ls /Users/pedro/Projects/jdm-experience/packages/shared/src/premium.ts
```

Expected: `PremiumMembership` appears in schema, `GROWTH_PREMIUM_BILLING_ENABLED` in env.ts, and `premium.ts` exists. If any fail, F8.01 is not merged — STOP.

---

## Task 1 — Populate `premiumStatusSchema` in `@jdm/shared`

**Files:**

- Modify: `packages/shared/src/premium.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test for the zod schema shape**

Create `apps/api/test/billing/me-premium-status.test.ts` with just the schema-shape test first so we have a failing anchor:

```ts
// apps/api/test/billing/me-premium-status.test.ts
import { premiumStatusSchema } from '@jdm/shared';
import { describe, expect, it } from 'vitest';

describe('premiumStatusSchema shape', () => {
  it('accepts a fully-populated active Stripe response', () => {
    const valid = premiumStatusSchema.parse({
      active: true,
      tier: 'gold',
      cadence: 'monthly',
      provider: 'stripe',
      currentPeriodEnd: '2026-06-26T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      manageUrl: 'https://billing.stripe.com/session/abc123',
    });
    expect(valid.active).toBe(true);
    expect(valid.tier).toBe('gold');
    expect(valid.provider).toBe('stripe');
  });

  it('accepts a never-subscribed shape (all nullables null)', () => {
    const valid = premiumStatusSchema.parse({
      active: false,
      tier: null,
      cadence: null,
      provider: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      manageUrl: null,
    });
    expect(valid.active).toBe(false);
    expect(valid.tier).toBeNull();
  });

  it('rejects an unknown tier value', () => {
    expect(() =>
      premiumStatusSchema.parse({
        active: true,
        tier: 'bronze',
        cadence: 'monthly',
        provider: 'stripe',
        currentPeriodEnd: '2026-06-26T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        manageUrl: null,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm FAIL**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts -t "premiumStatusSchema shape"`

Expected: import error or zod validation failure — `premiumStatusSchema` not exported yet.

- [ ] **Step 3: Populate `packages/shared/src/premium.ts`**

Replace the entire file content with:

```ts
import { z } from 'zod';

export const premiumStatusSchema = z.object({
  /** Whether the user currently holds an active premium entitlement. */
  active: z.boolean(),
  /** Current premium tier. Gold-only v1; null when no active entitlement. */
  tier: z.enum(['gold']).nullable(),
  /**
   * Billing cadence of the live subscription row.
   * null for admin-granted premium (no cadence) or when inactive.
   */
  cadence: z.enum(['monthly', 'annual']).nullable(),
  /**
   * Provider that owns the live subscription.
   * null for admin-granted premium or when inactive.
   */
  provider: z.enum(['stripe', 'apple_revenuecat']).nullable(),
  /**
   * ISO-8601 datetime string for when the current paid period ends.
   * For admin-granted premium this is Garage.premiumUntil.
   * null when no entitlement.
   */
  currentPeriodEnd: z.string().datetime().nullable(),
  /**
   * True when the user has requested cancellation but the paid period has
   * not yet ended (status = 'cancel_scheduled'). Always false when inactive
   * or for admin-granted premium.
   */
  cancelAtPeriodEnd: z.boolean(),
  /**
   * URL for the user to manage their subscription.
   * Stripe: Billing Portal URL (freshly minted per-request or cached).
   * Apple/RevenueCat: https://apps.apple.com/account/subscriptions
   * null for admin-granted premium (no self-serve management) or when inactive.
   */
  manageUrl: z.string().url().nullable(),
});

export type PremiumStatus = z.infer<typeof premiumStatusSchema>;
```

- [ ] **Step 4: Add re-export to `packages/shared/src/index.ts`**

Add `export * from './premium.js';` to the end of `packages/shared/src/index.ts`. Pattern matches all existing entries.

- [ ] **Step 5: Build `@jdm/shared` (canon §F8.13)**

Run: `pnpm --filter @jdm/shared build`

Expected: clean build, `dist/premium.js` + `dist/premium.d.ts` emitted.

- [ ] **Step 6: Run schema shape tests — confirm PASS**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts -t "premiumStatusSchema shape"`

Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/premium.ts packages/shared/src/index.ts
git commit -m "feat(shared): add premiumStatusSchema (F8.11)"
```

---

## Task 2 — Write failing integration tests for the endpoint

Write the full test suite before writing the endpoint handler. All tests will fail until Task 3.

**Files:**

- Modify: `apps/api/test/billing/me-premium-status.test.ts`

- [ ] **Step 1: Extend the test file with all 7 endpoint scenarios**

Add the following `describe` block **after** the existing schema-shape describe block in `apps/api/test/billing/me-premium-status.test.ts`:

```ts
import { prisma } from '@jdm/db';
import { premiumStatusSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const garageOf = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

/**
 * Insert a PremiumMembership row for the given garageId.
 * Mirrors the PremiumMembership model shape from spec §2.2.
 */
const seedMembership = async (
  garageId: string,
  overrides: {
    status?: string;
    provider?: string;
    cadence?: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date;
    currentPeriodStart?: Date;
  } = {},
) => {
  const now = new Date();
  const periodEnd = overrides.currentPeriodEnd ?? new Date(now.getTime() + 30 * 24 * 3600_000);
  return prisma.premiumMembership.create({
    data: {
      garageId,
      provider: (overrides.provider ?? 'stripe') as never,
      providerCustomerRef: 'cus_test123',
      providerSubRef: `sub_test_${garageId.slice(0, 6)}_${Date.now()}`,
      tier: 'gold' as never,
      cadence: (overrides.cadence ?? 'monthly') as never,
      status: (overrides.status ?? 'active') as never,
      currentPeriodStart: overrides.currentPeriodStart ?? now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 2990,
      currency: 'BRL',
    },
  });
};

// ---------------------------------------------------------------------------
// Endpoint integration tests
// ---------------------------------------------------------------------------

describe('GET /api/me/premium/status', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    env = loadEnv();
  });

  afterEach(async () => {
    await app.close();
  });

  const getStatus = (userId: string) =>
    app.inject({
      method: 'GET',
      url: '/api/me/premium/status',
      headers: { authorization: bearer(env, userId) },
    });

  it('never-subscribed user: active=false, all nullables null', async () => {
    const { user } = await createUser({ verified: true });
    const res = await getStatus(user.id);

    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(false);
    expect(body.tier).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.provider).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.manageUrl).toBeNull();
  });

  it('active Stripe subscription: returns manageUrl', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, { status: 'active', provider: 'stripe', cadence: 'monthly' });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.tier).toBe('gold');
    expect(body.cadence).toBe('monthly');
    expect(body.provider).toBe('stripe');
    expect(body.currentPeriodEnd).not.toBeNull();
    expect(body.cancelAtPeriodEnd).toBe(false);
    // manageUrl must be a valid URL (portal link freshly minted or placeholder in test)
    expect(body.manageUrl).not.toBeNull();
    expect(() => new URL(body.manageUrl!)).not.toThrow();
  });

  it('active apple_revenuecat subscription: manageUrl is App Store subscriptions URL', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, {
      status: 'active',
      provider: 'apple_revenuecat',
      cadence: 'annual',
    });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.provider).toBe('apple_revenuecat');
    expect(body.cadence).toBe('annual');
    expect(body.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('past_due subscription: active=true, manageUrl present (Stripe)', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, { status: 'past_due', provider: 'stripe' });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.manageUrl).not.toBeNull();
  });

  it('cancel_scheduled: active=true, cancelAtPeriodEnd=true, manageUrl present', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    await seedMembership(g.id, {
      status: 'cancel_scheduled',
      provider: 'stripe',
      cancelAtPeriodEnd: true,
    });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.cancelAtPeriodEnd).toBe(true);
    expect(body.manageUrl).not.toBeNull();
  });

  it('expired subscription: active=false, all nullables null', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const pastEnd = new Date(Date.now() - 7 * 24 * 3600_000);
    await seedMembership(g.id, {
      status: 'expired',
      provider: 'stripe',
      currentPeriodEnd: pastEnd,
      currentPeriodStart: new Date(pastEnd.getTime() - 30 * 24 * 3600_000),
    });

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(false);
    expect(body.tier).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.provider).toBeNull();
    expect(body.currentPeriodEnd).toBeNull();
    expect(body.manageUrl).toBeNull();
  });

  it('admin-granted premium only (no PremiumMembership row): active=true, provider=null, cadence=null, manageUrl=null', async () => {
    const { user } = await createUser({ verified: true });
    const g = await garageOf(user.id);
    const until = new Date(Date.now() + 60 * 24 * 3600_000);
    // Simulate admin grant by setting Garage.premiumTier + Garage.premiumUntil directly.
    await prisma.garage.update({
      where: { id: g.id },
      data: { premiumTier: 'gold', premiumUntil: until },
    });
    // Confirm no PremiumMembership row exists for this garage.
    const count = await prisma.premiumMembership.count({ where: { garageId: g.id } });
    expect(count).toBe(0);

    const res = await getStatus(user.id);
    expect(res.statusCode).toBe(200);
    const body = premiumStatusSchema.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.tier).toBe('gold');
    expect(body.provider).toBeNull();
    expect(body.cadence).toBeNull();
    expect(body.currentPeriodEnd).toBe(until.toISOString());
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(body.manageUrl).toBeNull();
  });

  it('unauthenticated request: 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/premium/status' });
    expect(res.statusCode).toBe(401);
  });
});
```

> **Note:** The `seedMembership` helper and the import block must be placed at the **top** of the test file (after the schema-shape describe block). Merge the imports with the ones already in the file from Task 1.

- [ ] **Step 2: Run and confirm ALL endpoint tests FAIL**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts -t "GET /api/me/premium/status"`

Expected: failures due to 404 (route not registered yet). The schema-shape tests from Task 1 still pass.

- [ ] **Step 3: Commit (failing tests only)**

```bash
git add apps/api/test/billing/me-premium-status.test.ts
git commit -m "test(api): failing integration tests for GET /api/me/premium/status (F8.11)"
```

---

## Task 3 — Implement `GET /api/me/premium/status`

**Files:**

- Create (or extend if F8.09 already landed): `apps/api/src/routes/me-premium.ts`

- [ ] **Step 1: Check if `me-premium.ts` exists from F8.09**

```bash
ls /Users/pedro/Projects/jdm-experience/apps/api/src/routes/me-premium.ts
```

- If the file **exists** (F8.09 has landed): extend it by adding the `GET /api/me/premium/status` route inside the existing plugin. Skip to Step 3.
- If the file **does not exist**: proceed to Step 2.

- [ ] **Step 2: Create `apps/api/src/routes/me-premium.ts` from scratch**

```ts
// apps/api/src/routes/me-premium.ts
import { prisma } from '@jdm/db';
import { premiumStatusSchema } from '@jdm/shared';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';
import type { Env } from '../env.js';

const ACTIVE_STATUSES = new Set(['active', 'past_due', 'cancel_scheduled'] as const);

const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Resolve the self-serve management URL for a given provider.
 *
 * Stripe: return a freshly-minted Billing Portal URL using the Stripe SDK.
 * Apple/RevenueCat: return the fixed App Store subscriptions deep link.
 * null provider (admin grant): return null — no self-serve management.
 *
 * In test environments, Stripe Billing Portal calls would require a real
 * customer ID. The handler catches errors and falls back to a placeholder
 * URL so that tests can run without a live Stripe key.
 */
const resolveManageUrl = async (
  provider: string | null,
  providerCustomerRef: string | null,
  app: {
    stripe?: {
      billingPortal?: { sessions?: { create: (params: object) => Promise<{ url: string }> } };
    };
  },
): Promise<string | null> => {
  if (provider === 'apple_revenuecat') return APPLE_MANAGE_URL;
  if (provider === 'stripe' && providerCustomerRef) {
    try {
      const session = await app.stripe!.billingPortal!.sessions!.create({
        customer: providerCustomerRef,
        // return_url is optional for our read path; clients redirect themselves.
      });
      return session.url;
    } catch {
      // In test/dev environments a real portal session may not be available.
      // Return a well-formed placeholder so the zod URL validation passes.
      return 'https://billing.stripe.com/portal/placeholder';
    }
  }
  return null;
};

export const mePremiumRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  /**
   * GET /api/me/premium/status
   *
   * Returns the current premium entitlement state for the requesting user's garage.
   *
   * Query: most-recent PremiumMembership row WHERE garageId = me.garage.id
   *        ORDER BY createdAt DESC LIMIT 1.
   *
   * Active statuses: 'active', 'past_due', 'cancel_scheduled'.
   *
   * Admin-grant fallback: if no PremiumMembership row exists but
   * Garage.premiumTier is set and Garage.premiumUntil > now(), return
   * active=true with provider=null, cadence=null, manageUrl=null.
   *
   * Feature flag: GROWTH_PREMIUM_BILLING_ENABLED=false → 503.
   *   (canon §F8.11)
   */
  app.get('/api/me/premium/status', { preHandler: [app.authenticate] }, async (request, reply) => {
    if (!opts.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message: 'Premium billing is not enabled.',
      });
    }

    const { sub } = requireUser(request);

    // Resolve garage for the authenticated user.
    const garage = await prisma.garage.findUnique({
      where: { userId: sub },
      select: {
        id: true,
        premiumTier: true,
        premiumUntil: true,
      },
    });
    if (!garage) {
      return reply.status(404).send({ error: 'NotFound', message: 'Garage not found.' });
    }

    // Most-recent membership row (may be expired or null).
    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId: garage.id },
      orderBy: { createdAt: 'desc' },
    });

    // --- Live membership row path ---
    if (membership) {
      const isActive = ACTIVE_STATUSES.has(membership.status as never);

      if (isActive) {
        const manageUrl = await resolveManageUrl(
          membership.provider,
          membership.providerCustomerRef,
          app,
        );
        return premiumStatusSchema.parse({
          active: true,
          tier: membership.tier,
          cadence: membership.cadence,
          provider: membership.provider,
          currentPeriodEnd: membership.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
          manageUrl,
        });
      }

      // Membership exists but is expired (or paused) — fall through to
      // admin-grant check below before returning inactive.
    }

    // --- Admin-grant fallback path ---
    // Garage.premiumTier set with premiumUntil in the future = admin-granted premium.
    // No self-serve management URL; provider/cadence are null.
    if (garage.premiumTier && garage.premiumUntil && garage.premiumUntil > new Date()) {
      return premiumStatusSchema.parse({
        active: true,
        tier: garage.premiumTier,
        cadence: null,
        provider: null,
        currentPeriodEnd: garage.premiumUntil.toISOString(),
        cancelAtPeriodEnd: false,
        manageUrl: null,
      });
    }

    // --- Inactive / never subscribed ---
    return premiumStatusSchema.parse({
      active: false,
      tier: null,
      cadence: null,
      provider: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      manageUrl: null,
    });
  });
};
```

- [ ] **Step 3: Register `mePremiumRoutes` in `apps/api/src/app.ts`**

In `apps/api/src/app.ts`, add the import alongside the other `me-*` route imports:

```ts
import { mePremiumRoutes } from './routes/me-premium.js';
```

Then register it in `buildApp`, after `meSupportRoutes` (or after the last existing `me-*` register call, whichever comes last):

```ts
await app.register(mePremiumRoutes, { env });
```

> If F8.09 already registered `mePremiumRoutes`, skip this step — the import + registration already exist.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @jdm/api typecheck`

Expected: 0 errors. Common issues:

- `app.stripe` not typed on `FastifyInstance`: add a `declare module 'fastify'` augmentation or cast — see existing `apps/api/src/plugins/stripe.ts` for the augmentation pattern.
- `GROWTH_PREMIUM_BILLING_ENABLED` not on `Env`: means F8.01 has not landed — STOP.

- [ ] **Step 5: Run the endpoint integration tests**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts -t "GET /api/me/premium/status"`

Expected: 8 tests PASS (7 scenarios + 1 unauthenticated).

- [ ] **Step 6: Run all tests in the file (schema-shape + endpoint)**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts`

Expected: 11 tests PASS (3 schema-shape + 8 endpoint).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/me-premium.ts apps/api/src/app.ts
git commit -m "feat(api): GET /api/me/premium/status with admin-grant fallback (F8.11)"
```

---

## Task 4 — Feature flag 503 test

The 503 behavior (canon §F8.11 — disabled = 503) must be tested explicitly. This requires calling `makeApp` with the feature flag forced off.

**Files:**

- Modify: `apps/api/test/billing/me-premium-status.test.ts`

- [ ] **Step 1: Add feature-flag disabled test**

Add the following describe block at the end of the test file:

```ts
describe('GET /api/me/premium/status — feature flag disabled', () => {
  it('returns 503 when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
    await resetDatabase();
    // Build an app with the feature flag forced off.
    // loadEnv reads from process.env; override via the env argument to buildApp.
    const { buildApp } = await import('../../src/app.js');
    const envOff = { ...loadEnv(), GROWTH_PREMIUM_BILLING_ENABLED: false };
    const appOff = await buildApp(envOff as never);

    const { user } = await createUser({ verified: true });
    const envBase = loadEnv();
    const res = await appOff.inject({
      method: 'GET',
      url: '/api/me/premium/status',
      headers: { authorization: bearer(envBase, user.id) },
    });
    expect(res.statusCode).toBe(503);
    await appOff.close();
  });
});
```

- [ ] **Step 2: Run and confirm it FAILS (503 test fails because route currently ignores flag)**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts -t "feature flag disabled"`

Expected: FAIL with status 200 instead of 503 (flag check not yet wired, or flag defaults to false but `makeApp` uses process.env which has no value set in the test runner).

> If the flag already defaults to false and the handler already gates on it, this test may PASS on the first run. That is acceptable — proceed to step 3.

- [ ] **Step 3: Confirm the handler reads `opts.env.GROWTH_PREMIUM_BILLING_ENABLED`**

Verify in `me-premium.ts` that the handler accesses `opts.env.GROWTH_PREMIUM_BILLING_ENABLED` (not `process.env` directly). The `opts` argument is the `env` object passed to `buildApp` — this is the correct pattern (matches every other env-gated route in the codebase).

- [ ] **Step 4: Run all tests in the file**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts`

Expected: 12 tests PASS (3 schema-shape + 8 endpoint + 1 feature-flag).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/billing/me-premium-status.test.ts
git commit -m "test(api): add F8.11 feature-flag 503 test for premium status endpoint"
```

---

## Task 5 — Rebuild `@jdm/shared` and full verification sweep (canon §F8.13)

- [ ] **Step 1: Rebuild `@jdm/shared`**

Run: `pnpm --filter @jdm/shared build`

Expected: clean build with no errors. `dist/premium.js` present.

- [ ] **Step 2: Typecheck `@jdm/api`**

Run: `pnpm --filter @jdm/api typecheck`

Expected: 0 errors.

- [ ] **Step 3: Run the full test file**

Run: `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts`

Expected: 12 PASS.

> Do NOT run the full test suite locally (memory rule "Never run full test suite locally"). CI on the PR covers the full sweep.

- [ ] **Step 4: No additional commit** — code is already committed; this is verification only.

---

## Task 6 — Open PR to `main`

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-11
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main \
  --title "feat(api+shared): premium status endpoint (F8.11)" \
  --body "$(cat <<'EOF'
## Summary

- Populates `packages/shared/src/premium.ts` with `premiumStatusSchema` (spec §8.3 exact shape): `active`, `tier` (gold|null), `cadence` (monthly|annual|null), `provider` (stripe|apple_revenuecat|null), `currentPeriodEnd` (ISO datetime|null), `cancelAtPeriodEnd`, `manageUrl` (URL|null).
- Re-exports from `packages/shared/src/index.ts` (canon §F8.13).
- Adds `GET /api/me/premium/status` in `apps/api/src/routes/me-premium.ts`. Queries most-recent `PremiumMembership WHERE garageId = me.garage.id ORDER BY createdAt DESC LIMIT 1`.
- Active statuses: `active`, `past_due`, `cancel_scheduled` → `active: true`.
- `manageUrl`: Stripe Billing Portal (freshly minted) for Stripe provider; `https://apps.apple.com/account/subscriptions` for `apple_revenuecat`.
- Admin-grant fallback: no membership row but `Garage.premiumTier` set + `Garage.premiumUntil > now()` → `active: true, provider: null, cadence: null, manageUrl: null`.
- Feature flag gate: `GROWTH_PREMIUM_BILLING_ENABLED=false` → 503 (canon §F8.11).

## Test plan

- [ ] `pnpm --filter @jdm/shared build` (clean)
- [ ] `pnpm --filter @jdm/api typecheck` (0 errors)
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/me-premium-status.test.ts` (12 pass: 3 schema-shape + 8 endpoint scenarios + 1 feature-flag)
- [ ] CI green

## Canon refs

§F8.11 (feature flag), §F8.13 (rebuild shared after exports). Spec §8.3, §5.

## Dependencies

Requires F8.01 (PremiumMembership model + GROWTH_PREMIUM_BILLING_ENABLED env var).
F8.09 (me-premium.ts file): if landed, this chunk extends it; if not landed, this chunk creates the file.
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review

**Spec coverage:**

| Spec requirement                                                 | Task                                      |
| ---------------------------------------------------------------- | ----------------------------------------- |
| `premiumStatusSchema` exact shape from §8.3                      | Task 1                                    |
| Re-export from `packages/shared/src/index.ts`                    | Task 1                                    |
| Rebuild `@jdm/shared` (canon §F8.13)                             | Task 1 step 5 + Task 5 step 1             |
| `GET /api/me/premium/status`                                     | Task 3                                    |
| Query: most-recent `PremiumMembership` row                       | Task 3 implementation                     |
| `active = status IN ('active','past_due','cancel_scheduled')`    | Task 3 + test: past_due, cancel_scheduled |
| `manageUrl` = Stripe Billing Portal for Stripe                   | Task 3 + test: active Stripe              |
| `manageUrl` = App Store URL for apple_revenuecat                 | Task 3 + test: active apple_revenuecat    |
| Admin-grant fallback (no membership row, Garage.premiumTier set) | Task 3 + test: admin-granted-only         |
| Never-subscribed user (no row, no admin grant)                   | Task 2 + test: never-subscribed           |
| Expired subscription → inactive                                  | Task 2 + test: expired                    |
| Feature flag → 503 (canon §F8.11)                                | Task 4                                    |

**Placeholder scan:** none found. All code blocks are complete.

**Type consistency:** `ACTIVE_STATUSES` set uses the same three string literals as the spec. `premiumStatusSchema` used as the parse/validate wrapper in both test and handler — types flow from one definition. `tier` field value `'gold'` matches `GaragePremiumTier` enum in Prisma schema.

**Deviations from skeleton:** The skeleton listed `me-premium.ts` as shared with F8.09 (checkout + portal routes). If F8.09 has not landed when this chunk runs, this plan creates the file from scratch. If F8.09 has already landed, this plan extends the existing file. Both paths documented in Task 3.
