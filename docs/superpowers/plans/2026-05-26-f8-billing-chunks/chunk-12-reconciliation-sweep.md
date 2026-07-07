# Chunk F8.12 — Hourly Reconciliation Sweep Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a cron-driven hourly worker that detects and recovers from provider drift — memberships whose `currentPeriodEnd` has passed but whose DB status is still `active`, `past_due`, or `cancel_scheduled` — by calling the upstream provider (Stripe or RevenueCat REST) and either replaying a missed renewal or expiring the membership and clearing the Garage snapshot.

**Architecture:** A standalone worker module `billing-reconcile.ts` (mirrors `event-reminders.ts` pattern: exported `runReconcileTick` + exported `startReconcileWorker` with `cron.schedule`). It queries up to 200 stale rows per tick, branches on provider, calls either `stripe.subscriptions.retrieve` or a new minimal RC REST client `revenuecat/client.ts`. Recovery for renewed-but-missed events synthesises a `BillingEvent` of kind `subscription.renewed` and calls the existing `applyMembershipEvent(tx, evt)` from F8.03 — keeping the atomicity contract (§F8.4) untouched. Expiry calls `applyMembershipEvent(tx, { kind: 'subscription.expired', ... })`. Alert logging fires when the query returns the full 200-row cap.

**Tech Stack:** Fastify + Prisma + `node-cron`, Stripe Node SDK (`stripe.subscriptions.retrieve`), plain `fetch` for RC REST (`/v1/subscribers/{app_user_id}`), vitest + Testcontainers Postgres + mocked Stripe SDK + mocked RC client (via `vi.mock`), canon §F8.4 (`applyMembershipEvent` from F8.03).

---

## Required reading (before any code)

1. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` — §6 (reconciliation sweep spec, canonical), §3.5 (snapshot clear rule on expired).
2. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` — §F8.12 entry + canon §F8.4, §F8.11.
3. `apps/api/src/workers/event-reminders.ts` — the tick/worker split pattern to mirror exactly.
4. `apps/api/src/services/stripe/index.ts` — existing `StripeClient` type; you will ADD `retrieveSubscription` to this type and its `buildStripe` factory.
5. `apps/api/src/services/billing/apply-membership-event.ts` (lands in F8.03) — `applyMembershipEvent(tx, BillingEvent)`. Do NOT re-implement; import it.
6. `apps/api/src/services/billing/types.ts` (lands in F8.02) — `BillingEvent` discriminated union, specifically the `subscription.renewed` and `subscription.expired` variants.
7. `apps/api/src/env.ts` — the `envSchema` / `loadEnv` pattern; add two vars in this chunk.
8. `CLAUDE.md` — branch preflight + real-Postgres + no full-suite local run.

## Dependencies (must be merged on `main` before this chunk)

- **F8.01** — Schema (`PremiumMembership`, enums, `GROWTH_PREMIUM_BILLING_ENABLED` in env).
- **F8.02** — `BillingEvent` types + `subscription.renewed` / `subscription.expired` variants.
- **F8.03** — `applyMembershipEvent(tx, BillingEvent)` service.

If any is missing, STOP and dispatch it first.

## File structure

```
apps/api/src/services/revenuecat/client.ts          (NEW) — RC REST client
apps/api/src/services/stripe/index.ts               (MODIFY) — add retrieveSubscription
apps/api/src/env.ts                                 (MODIFY) — add REVENUECAT_REST_API_KEY,
                                                               RECONCILE_ALERT_DEPTH
apps/api/src/workers/billing-reconcile.ts           (NEW) — runReconcileTick + startReconcileWorker
apps/api/src/app.ts                                 (MODIFY) — register cron when flag+worker enabled
apps/api/src/workers/billing-reconcile.test.ts      (NEW) — Testcontainers + mocked providers
```

---

## Task 1 — Env vars + RC REST client (stubs)

**Files:** Modify `apps/api/src/env.ts`. Create `apps/api/src/services/revenuecat/client.ts`.

- [ ] **1.1:** Open `apps/api/src/env.ts`. Inside the `envSchema` object, after `RETENTION_WORKER_ENABLED`, add:

```ts
  REVENUECAT_REST_API_KEY: z.string().min(1).optional(),
  RECONCILE_ALERT_DEPTH: z.coerce.number().int().positive().default(200),
```

`REVENUECAT_REST_API_KEY` is optional so tests run without it. `RECONCILE_ALERT_DEPTH` sets the configurable queue-depth alert threshold (default = 200, which matches the query LIMIT so the alert fires whenever the tick is full).

- [ ] **1.2:** Create `apps/api/src/services/revenuecat/client.ts`:

```ts
export type RCEntitlement = {
  expiresDate: string | null; // ISO-8601 or null (lifetime)
  productIdentifier: string;
  purchaseDate: string;
};

export type RCSubscriber = {
  entitlements: Record<string, RCEntitlement>;
  subscriptions: Record<
    string,
    {
      expiresDate: string | null;
      periodType: string; // 'normal' | 'trial' | 'intro'
      productIdentifier: string;
      store: string; // 'app_store' | 'play_store' | 'stripe' | …
    }
  >;
};

export type RevenueCatClient = {
  getSubscriber: (appUserId: string) => Promise<RCSubscriber>;
};

export const buildRevenueCatClient = (apiKey: string): RevenueCatClient => {
  return {
    getSubscriber: async (appUserId) => {
      const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`RevenueCat API error ${res.status} for subscriber ${appUserId}`);
      }
      const body = (await res.json()) as { subscriber: RCSubscriber };
      return body.subscriber;
    },
  };
};
```

- [ ] **1.3:** Run `pnpm --filter @jdm/api typecheck`. Expected: PASS. This confirms the env addition compiles and the RC client types are sound.

- [ ] **1.4:** Commit:

```bash
git add apps/api/src/env.ts apps/api/src/services/revenuecat/client.ts
git commit -m "feat(api): add REVENUECAT_REST_API_KEY + RECONCILE_ALERT_DEPTH env vars; RC REST client stub (chunk F8.12)"
```

---

## Task 2 — Extend StripeClient with `retrieveSubscription`

**Files:** Modify `apps/api/src/services/stripe/index.ts`.

- [ ] **2.1:** Write the failing test first. Create `apps/api/test/billing/stripe-retrieve-subscription.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the StripeClient shape by verifying the method exists and resolves
// to an object with the expected fields. We mock the stripe SDK internals.
// This is the minimal test that pins the interface — the full reconcile tests
// in Task 5 exercise the integration path.

import { buildStripe } from '../../src/services/stripe/index.js';

vi.mock('stripe', () => {
  const fakeSub = {
    id: 'sub_123',
    status: 'active',
    current_period_end: 9999999999, // Unix timestamp far in the future
    items: {
      data: [
        {
          price: {
            id: 'price_monthly',
            metadata: { baseAmountCents: '2990', devFeePercent: '10' },
            currency: 'brl',
            recurring: { interval: 'month' },
            product: 'prod_gold',
          },
        },
      ],
    },
    customer: 'cus_abc',
    cancel_at_period_end: false,
    canceled_at: null,
  };
  return {
    default: vi.fn().mockImplementation(() => ({
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue(fakeSub),
      },
      paymentIntents: {
        create: vi.fn(),
        cancel: vi.fn(),
        retrieve: vi.fn(),
      },
      checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
      parseEventNotification: vi.fn(),
      refunds: { create: vi.fn() },
    })),
  };
});

describe('StripeClient.retrieveSubscription', () => {
  let client: ReturnType<typeof buildStripe>;
  beforeEach(() => {
    client = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      STRIPE_WEBHOOK_SECRET: 'whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
  });

  it('resolves with id, status, and current_period_end', async () => {
    const sub = await client.retrieveSubscription('sub_123');
    expect(sub.id).toBe('sub_123');
    expect(sub.status).toBe('active');
    expect(typeof sub.current_period_end).toBe('number');
  });
});
```

- [ ] **2.2:** Run `pnpm --filter @jdm/api exec vitest run test/billing/stripe-retrieve-subscription.test.ts`. Expected: FAIL — `client.retrieveSubscription is not a function` (method does not exist yet).

- [ ] **2.3:** Open `apps/api/src/services/stripe/index.ts`. Add to the `StripeClient` type (after `retrievePaymentIntent`):

```ts
retrieveSubscription: (subId: string) => Promise<Stripe.Subscription>;
```

Add the implementation at the end of the returned object in `buildStripe` (after `publishableKey`):

```ts
    retrieveSubscription: async (subId) => {
      return stripe.subscriptions.retrieve(subId, {
        expand: ['items.data.price.product'],
      });
    },
```

- [ ] **2.4:** Run `pnpm --filter @jdm/api exec vitest run test/billing/stripe-retrieve-subscription.test.ts`. Expected: PASS.

- [ ] **2.5:** Run `pnpm --filter @jdm/api typecheck`. Expected: PASS.

- [ ] **2.6:** Commit:

```bash
git add apps/api/src/services/stripe/index.ts apps/api/test/billing/stripe-retrieve-subscription.test.ts
git commit -m "feat(api): add retrieveSubscription to StripeClient (chunk F8.12)"
```

---

## Task 3 — Reconcile worker scaffold (stub that throws)

**Files:** Create `apps/api/src/workers/billing-reconcile.ts`.

- [ ] **3.1:** Create `apps/api/src/workers/billing-reconcile.ts` with a stub body:

```ts
import { prisma } from '@jdm/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import type { StripeClient } from '../services/stripe/index.js';
import type { RevenueCatClient } from '../services/revenuecat/client.js';

export type ReconcileTickDeps = {
  stripe: StripeClient;
  rc: RevenueCatClient;
  alertDepth: number;
  now?: Date;
  log?: FastifyBaseLogger;
};

/**
 * One reconciliation tick. Exported for direct testing.
 * Side effects: may call applyMembershipEvent (tx) per stale row.
 */
export const runReconcileTick = async (_deps: ReconcileTickDeps): Promise<void> => {
  throw new Error('not implemented');
};

export const startReconcileWorker = (deps: {
  stripe: StripeClient;
  rc: RevenueCatClient;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('0 * * * *', () => {
    void runReconcileTick({
      stripe: deps.stripe,
      rc: deps.rc,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'billing-reconcile tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
```

- [ ] **3.2:** Run `pnpm --filter @jdm/api typecheck`. Expected: PASS.

- [ ] **3.3:** Commit:

```bash
git add apps/api/src/workers/billing-reconcile.ts
git commit -m "feat(api): reconcile worker scaffold stub (chunk F8.12)"
```

---

## Task 4 — Write all failing tests (Testcontainers)

**Files:** Create `apps/api/src/workers/billing-reconcile.test.ts`.

This test file exercises the full `runReconcileTick` surface using a real Postgres DB (Testcontainers) and mocked network clients (Stripe SDK mock + RC client mock). All five spec-required scenarios are written here before any implementation.

The test file follows the same helper pattern as existing API integration tests: `makeApp`, `resetDatabase`, `createUser` from `apps/api/test/helpers.ts`, plus a `prisma` client for direct DB assertions.

- [ ] **4.1:** Create `apps/api/src/workers/billing-reconcile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { prisma } from '@jdm/db';

import { runReconcileTick, type ReconcileTickDeps } from './billing-reconcile.js';
import { resetDatabase } from '../../test/helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal PremiumMembership row + Garage seed in the test DB. */
async function seedMembership(overrides: {
  status: 'active' | 'past_due' | 'cancel_scheduled';
  provider: 'stripe' | 'apple_revenuecat';
  providerSubRef: string;
  providerCustomerRef: string;
  currentPeriodEnd: Date;
  garageId?: string;
}) {
  // Seed a user + garage if not provided
  const { createUser } = await import('../../test/helpers.js');
  const { user } = await createUser({ email: `rectest-${Date.now()}@jdm.test`, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

  const gid = overrides.garageId ?? garage.id;

  const past = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: gid,
      provider: overrides.provider,
      providerCustomerRef: overrides.providerCustomerRef,
      providerSubRef: overrides.providerSubRef,
      tier: 'gold',
      cadence: 'monthly',
      status: overrides.status,
      currentPeriodStart: new Date(past.getTime() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: overrides.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 2990,
      currency: 'BRL',
    },
  });

  // Update Garage snapshot to reflect active membership
  await prisma.garage.update({
    where: { id: gid },
    data: { premiumTier: 'gold', premiumUntil: overrides.currentPeriodEnd },
  });

  return { membership, garage: await prisma.garage.findUniqueOrThrow({ where: { id: gid } }) };
}

const makeStripeMock = (subStatus: string, newPeriodEnd: number) =>
  ({
    retrieveSubscription: vi.fn().mockResolvedValue({
      id: 'sub_test',
      status: subStatus,
      current_period_end: newPeriodEnd,
      cancel_at_period_end: false,
      canceled_at: null,
      customer: 'cus_test',
      items: {
        data: [
          {
            price: {
              id: 'price_monthly',
              metadata: { baseAmountCents: '2990', devFeePercent: '10' },
              currency: 'brl',
              recurring: { interval: 'month' },
              product: { id: 'prod_gold' },
            },
          },
        ],
      },
    }),
    // other StripeClient methods not used by reconcile
    createPaymentIntent: vi.fn(),
    createCheckoutSession: vi.fn(),
    getCheckoutSessionPaymentIntentId: vi.fn(),
    constructWebhookEvent: vi.fn(),
    refund: vi.fn(),
    cancelPaymentIntent: vi.fn(),
    retrievePaymentIntent: vi.fn(),
    publishableKey: vi.fn().mockReturnValue('pk_test'),
  }) as any;

const makeRcMock = (expiresDate: string | null) =>
  ({
    getSubscriber: vi.fn().mockResolvedValue({
      entitlements: {
        premium_gold: {
          expiresDate,
          productIdentifier: 'jdm_premium_monthly',
          purchaseDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      subscriptions: {},
    }),
  }) as any;

const baseLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runReconcileTick', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  // ---- Test 1: no stale rows — tick is a no-op ---------------------------

  it('no-op when no stale memberships exist', async () => {
    // Seed a membership with currentPeriodEnd in the future
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_future',
      providerCustomerRef: 'cus_future',
      currentPeriodEnd: future,
    });

    const stripe = makeStripeMock('active', Math.floor(future.getTime() / 1000));
    const rc = makeRcMock(future.toISOString());
    const deps: ReconcileTickDeps = { stripe, rc, alertDepth: 200, log: baseLog };

    await runReconcileTick(deps);

    // No provider calls made because no stale rows
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(rc.getSubscriber).not.toHaveBeenCalled();
    expect(baseLog.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reconcile.recovered' }),
    );
  });

  // ---- Test 2: Stripe drift recovery (missed renewal webhook) ----------

  it('Stripe: recovers missed renewal — updates membership period + Garage snapshot', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000); // 30min ago
    const { membership } = await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_drifted',
      providerCustomerRef: 'cus_drifted',
      currentPeriodEnd: staleEnd,
    });

    // Stripe says sub is still active, period already renewed to +30 days
    const newPeriodEndUnix = Math.floor((Date.now() + 29 * 24 * 60 * 60 * 1000) / 1000);
    const stripe = makeStripeMock('active', newPeriodEndUnix);
    const rc = makeRcMock(null);

    const deps: ReconcileTickDeps = { stripe, rc, alertDepth: 200, log: baseLog };
    await runReconcileTick(deps);

    expect(stripe.retrieveSubscription).toHaveBeenCalledWith('sub_drifted');

    // Membership currentPeriodEnd must be updated forward
    const updated = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(updated.status).toBe('active');
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(staleEnd.getTime());

    // Garage snapshot must reflect the new period end (max() rule §F8.3)
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();
    expect(garage.premiumUntil!.getTime()).toBeGreaterThan(staleEnd.getTime());

    // Structured log emitted
    expect(baseLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reconcile.recovered',
        provider: 'stripe',
        membershipId: membership.id,
      }),
      expect.any(String),
    );
  });

  // ---- Test 3: Stripe drift expiry (sub canceled at provider) ----------

  it('Stripe: transitions to expired + clears Garage snapshot when sub is canceled', async () => {
    const staleEnd = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const { membership } = await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_canceled',
      providerCustomerRef: 'cus_canceled',
      currentPeriodEnd: staleEnd,
    });

    // Stripe says sub is canceled
    const stripe = makeStripeMock('canceled', Math.floor(staleEnd.getTime() / 1000));
    const rc = makeRcMock(null);

    const deps: ReconcileTickDeps = { stripe, rc, alertDepth: 200, log: baseLog };
    await runReconcileTick(deps);

    const expired = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(expired.status).toBe('expired');

    // Garage snapshot cleared (§3.5 rule)
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();

    expect(baseLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reconcile.expired',
        provider: 'stripe',
        membershipId: membership.id,
      }),
      expect.any(String),
    );
  });

  // ---- Test 4: RC drift recovery ----------------------------------------

  it('RC: recovers missed renewal when entitlement still valid in RevenueCat', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000); // 30min ago
    const { membership } = await seedMembership({
      status: 'active',
      provider: 'apple_revenuecat',
      providerSubRef: 'entitlement_premium_gold',
      providerCustomerRef: 'garage_rc_user_1',
      currentPeriodEnd: staleEnd,
    });

    // RC says entitlement still active, expires +30 days
    const newExpiry = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const rc = makeRcMock(newExpiry.toISOString());
    const stripe = makeStripeMock('canceled', 0); // unused for RC path

    const deps: ReconcileTickDeps = { stripe, rc, alertDepth: 200, log: baseLog };
    await runReconcileTick(deps);

    expect(rc.getSubscriber).toHaveBeenCalledWith('garage_rc_user_1');

    const updated = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(updated.status).toBe('active');
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(staleEnd.getTime());

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();

    expect(baseLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reconcile.recovered',
        provider: 'apple_revenuecat',
        membershipId: membership.id,
      }),
      expect.any(String),
    );
  });

  // ---- Test 5: alert when queue depth reaches RECONCILE_ALERT_DEPTH -----

  it('emits structured alert when stale row count equals alertDepth threshold', async () => {
    // Seed exactly 2 stale rows (use alertDepth=2 to trigger the alert cheaply)
    const staleEnd = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_alert_1',
      providerCustomerRef: 'cus_alert_1',
      currentPeriodEnd: staleEnd,
    });
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_alert_2',
      providerCustomerRef: 'cus_alert_2',
      currentPeriodEnd: staleEnd,
    });

    // Stripe says both are canceled (simplest path — we just want alert logic)
    const stripe = makeStripeMock('canceled', Math.floor(staleEnd.getTime() / 1000));
    const rc = makeRcMock(null);

    const alertLog = { ...baseLog, warn: vi.fn() };
    const deps: ReconcileTickDeps = { stripe, rc, alertDepth: 2, log: alertLog };
    await runReconcileTick(deps);

    // Alert fires because rows returned === alertDepth
    expect(alertLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reconcile.queue_depth_alert', depth: 2, alertDepth: 2 }),
      expect.any(String),
    );
  });

  // ---- Test 6: flag disabled — tick is a no-op ---------------------------

  it('flag disabled (GROWTH_PREMIUM_BILLING_ENABLED=false) — tick exits immediately without DB reads', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000);
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_flagoff',
      providerCustomerRef: 'cus_flagoff',
      currentPeriodEnd: staleEnd,
    });

    const stripe = makeStripeMock('active', Math.floor(Date.now() / 1000) + 86400);
    const rc = makeRcMock(null);
    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: baseLog,
      flagEnabled: false,
    };

    await runReconcileTick(deps);

    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(rc.getSubscriber).not.toHaveBeenCalled();
  });
});
```

Note: the `flagEnabled` field on `ReconcileTickDeps` is not yet in the scaffold — it will be added with the implementation in Task 5.

- [ ] **4.2:** Run `pnpm --filter @jdm/api exec vitest run src/workers/billing-reconcile.test.ts`. Expected: all 6 tests FAIL with `Error: not implemented`. This confirms the test harness boots and the stubs are reached.

- [ ] **4.3:** Commit:

```bash
git add apps/api/src/workers/billing-reconcile.test.ts
git commit -m "test(api): write all failing reconcile sweep tests before implementation (chunk F8.12)"
```

---

## Task 5 — Implement `runReconcileTick`

**Files:** Modify `apps/api/src/workers/billing-reconcile.ts`.

- [ ] **5.1:** First update the `ReconcileTickDeps` type to add `flagEnabled` (default `true` so existing callers need no change). This satisfies Test 6:

In `billing-reconcile.ts`, update the type:

```ts
export type ReconcileTickDeps = {
  stripe: StripeClient;
  rc: RevenueCatClient;
  alertDepth: number;
  flagEnabled?: boolean; // defaults to true; pass false to short-circuit
  now?: Date;
  log?: FastifyBaseLogger;
};
```

- [ ] **5.2:** Replace the `runReconcileTick` stub with the full implementation. The full file after this step:

```ts
import { prisma } from '@jdm/db';
import type { PremiumMembership } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import type { Env } from '../env.js';
import { applyMembershipEvent } from '../services/billing/apply-membership-event.js';
import type { BillingEvent } from '../services/billing/types.js';
import type { RevenueCatClient } from '../services/revenuecat/client.js';
import type { StripeClient } from '../services/stripe/index.js';

export type ReconcileTickDeps = {
  stripe: StripeClient;
  rc: RevenueCatClient;
  alertDepth: number;
  flagEnabled?: boolean;
  now?: Date;
  log?: FastifyBaseLogger;
};

const STALE_STATUSES = ['active', 'past_due', 'cancel_scheduled'] as const;
const QUERY_LIMIT = 200;

// ---------------------------------------------------------------------------
// Per-row reconciliation helpers
// ---------------------------------------------------------------------------

/**
 * Reconcile one Stripe-backed membership.
 * Returns the BillingEvent to apply, or null if no action needed.
 */
const reconcileStripeRow = async (
  row: PremiumMembership,
  stripe: StripeClient,
  now: Date,
): Promise<BillingEvent | null> => {
  const sub = await stripe.retrieveSubscription(row.providerSubRef);

  if (sub.status === 'active' && sub.current_period_end > Math.floor(now.getTime() / 1000)) {
    // Webhook was lost — synthesise a renewal BillingEvent
    const newPeriodEnd = new Date(sub.current_period_end * 1000);
    const price = sub.items.data[0]?.price;
    const baseAmountCents = price
      ? parseInt(String(price.metadata?.baseAmountCents ?? '0'), 10)
      : row.baseAmountCents;
    const devFeePercent = price
      ? parseInt(String(price.metadata?.devFeePercent ?? '0'), 10)
      : row.devFeePercent;
    const devFeeAmountCents = Math.round((baseAmountCents * devFeePercent) / 100);
    const grossAmountCents = baseAmountCents; // per §F8.1 — gross = customer-facing price

    const renewalEvent: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: row.providerSubRef,
      currentPeriodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // approx; snapshot is load-bearing
      currentPeriodEnd: newPeriodEnd,
      pricing: {
        baseAmountCents,
        devFeePercent,
        devFeeAmountCents,
        grossAmountCents,
        currency: row.currency,
      },
      // Reconcile-synthesised renewal has no real invoice ref — use a sentinel
      // so applyMembershipEvent's Invoice insert is skipped for reconcile-only rows.
      // NOTE: if applyMembershipEvent requires an invoice on 'renewed', provide a
      // synthetic providerInvoiceRef with prefix 'reconcile:' to avoid collisions.
      invoice: {
        providerInvoiceRef: `reconcile:${row.providerSubRef}:${sub.current_period_end}`,
        periodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        periodEnd: newPeriodEnd,
        paidAt: now, // synthetic — actual charge date is unknown from retrieve()
      },
    };
    return renewalEvent;
  }

  if (['canceled', 'incomplete_expired', 'unpaid'].includes(sub.status)) {
    const expiredEvent: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: row.providerSubRef,
      cancelledAt: now,
    };
    return expiredEvent;
  }

  return null; // in-flight dunning; no action
};

/**
 * Reconcile one RC-backed membership.
 * Returns the BillingEvent to apply, or null if no action needed.
 */
const reconcileRcRow = async (
  row: PremiumMembership,
  rc: RevenueCatClient,
  now: Date,
): Promise<BillingEvent | null> => {
  const subscriber = await rc.getSubscriber(row.providerCustomerRef);

  // Find the premium_gold entitlement
  const entitlement = subscriber.entitlements['premium_gold'];
  if (!entitlement) {
    // Entitlement missing from RC — treat as expired
    const expiredEvent: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'apple_revenuecat',
      providerSubRef: row.providerSubRef,
      cancelledAt: now,
    };
    return expiredEvent;
  }

  if (entitlement.expiresDate !== null) {
    const expiresAt = new Date(entitlement.expiresDate);
    if (expiresAt > now) {
      // Entitlement still valid — webhook was lost; synthesise renewal
      const renewalEvent: BillingEvent = {
        kind: 'subscription.renewed',
        provider: 'apple_revenuecat',
        providerSubRef: row.providerSubRef,
        currentPeriodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: expiresAt,
        pricing: {
          baseAmountCents: row.baseAmountCents,
          devFeePercent: 0, // §F8.1 — Apple/RC path: devFeePercent = 0
          devFeeAmountCents: 0,
          grossAmountCents: row.grossAmountCents,
          currency: row.currency,
        },
        invoice: {
          providerInvoiceRef: `reconcile:${row.providerSubRef}:${expiresAt.getTime()}`,
          periodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          periodEnd: expiresAt,
          paidAt: now,
        },
      };
      return renewalEvent;
    }
  }

  // expiresDate is null (lifetime) — entitlement still valid; no action
  if (entitlement.expiresDate === null) return null;

  // expiresDate in the past — expired
  const expiredEvent: BillingEvent = {
    kind: 'subscription.expired',
    provider: 'apple_revenuecat',
    providerSubRef: row.providerSubRef,
    cancelledAt: now,
  };
  return expiredEvent;
};

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

export const runReconcileTick = async (deps: ReconcileTickDeps): Promise<void> => {
  const flagEnabled = deps.flagEnabled ?? true;
  if (!flagEnabled) return; // §F8.11 — feature flag gate

  const now = deps.now ?? new Date();
  const log = deps.log;

  // Query up to QUERY_LIMIT stale rows
  const staleRows = await prisma.premiumMembership.findMany({
    where: {
      status: { in: STALE_STATUSES },
      currentPeriodEnd: { lt: now },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: QUERY_LIMIT,
  });

  // Alert when queue depth fills the limit — indicates backlog
  if (staleRows.length >= deps.alertDepth) {
    log?.warn(
      {
        kind: 'reconcile.queue_depth_alert',
        depth: staleRows.length,
        alertDepth: deps.alertDepth,
      },
      'billing-reconcile: stale membership queue depth at or above alert threshold',
    );
  }

  for (const row of staleRows) {
    try {
      let evt: BillingEvent | null = null;

      if (row.provider === 'stripe') {
        evt = await reconcileStripeRow(row, deps.stripe, now);
      } else if (row.provider === 'apple_revenuecat') {
        evt = await reconcileRcRow(row, deps.rc, now);
      }

      if (!evt) {
        // In-flight dunning or lifetime entitlement — no action this tick
        log?.info(
          { kind: 'reconcile.skipped', provider: row.provider, membershipId: row.id },
          'billing-reconcile: row in-flight or lifetime, skipping',
        );
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await applyMembershipEvent(tx, evt!);
      });

      const logKind =
        evt.kind === 'subscription.expired' ? 'reconcile.expired' : 'reconcile.recovered';
      log?.info(
        { kind: logKind, provider: row.provider, membershipId: row.id, eventKind: evt.kind },
        `billing-reconcile: ${logKind}`,
      );
    } catch (err) {
      log?.error(
        { err, membershipId: row.id, provider: row.provider },
        'billing-reconcile: failed to reconcile row, continuing to next',
      );
      // Non-fatal: continue processing remaining rows
    }
  }
};

export const startReconcileWorker = (deps: {
  stripe: StripeClient;
  rc: RevenueCatClient;
  env: Env;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('0 * * * *', () => {
    void runReconcileTick({
      stripe: deps.stripe,
      rc: deps.rc,
      alertDepth: deps.env.RECONCILE_ALERT_DEPTH,
      flagEnabled: deps.env.GROWTH_PREMIUM_BILLING_ENABLED,
      log: deps.log,
    }).catch((err: unknown) => {
      deps.log.error({ err }, 'billing-reconcile tick failed');
    });
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
```

- [ ] **5.3:** Run `pnpm --filter @jdm/api typecheck`. Expected: PASS. Fix any type errors before proceeding.

- [ ] **5.4:** Run `pnpm --filter @jdm/api exec vitest run src/workers/billing-reconcile.test.ts`. Expected: all 6 tests PASS.

If Test 2 or Test 4 fail because `applyMembershipEvent` expects a specific invoice shape (e.g., rejects `reconcile:` prefixed refs), add a `skipInvoiceInsert: true` flag to the event or handle `P2002` on the invoice insert gracefully inside `applyMembershipEvent`. The reconcile path must be idempotent across ticks — `reconcile:sub_x:timestamp` as `providerInvoiceRef` achieves this if the F8.03 invoice insert catches P2002 silently (same as the webhook idempotency model §F8.15).

- [ ] **5.5:** Commit:

```bash
git add apps/api/src/workers/billing-reconcile.ts
git commit -m "feat(api): implement runReconcileTick — Stripe + RC drift recovery + alert (chunk F8.12)"
```

---

## Task 6 — Register worker in `app.ts`

**Files:** Modify `apps/api/src/app.ts`.

- [ ] **6.1:** Open `apps/api/src/app.ts`. After the existing import block for workers, add:

```ts
import { startReconcileWorker } from './workers/billing-reconcile.js';
import { buildRevenueCatClient } from './services/revenuecat/client.js';
```

- [ ] **6.2:** Locate the `if (env.WORKER_ENABLED && env.NODE_ENV === 'production')` block. Inside it, after the existing worker registrations, add:

```ts
if (env.GROWTH_PREMIUM_BILLING_ENABLED) {
  const rcApiKey = env.REVENUECAT_REST_API_KEY;
  if (!rcApiKey) {
    app.log.warn(
      { REVENUECAT_REST_API_KEY: undefined },
      '[billing-reconcile] REVENUECAT_REST_API_KEY not set — RC rows will error on reconcile ticks',
    );
  }
  const rc = buildRevenueCatClient(rcApiKey ?? '');
  const reconcileWorker = startReconcileWorker({
    stripe: app.stripe,
    rc,
    env,
    log: app.log,
  });
  app.addHook('onClose', () => {
    reconcileWorker.stop();
  });
}
```

- [ ] **6.3:** Run `pnpm --filter @jdm/api typecheck`. Expected: PASS.

- [ ] **6.4:** Commit:

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): register billing-reconcile cron worker in app.ts (chunk F8.12)"
```

---

## Task 7 — Final verification + branch hygiene

- [ ] **7.1:** Run `pnpm --filter @jdm/api typecheck`. Expected: PASS.

- [ ] **7.2:** Run the full chunk test suite:

```
pnpm --filter @jdm/api exec vitest run src/workers/billing-reconcile.test.ts test/billing/stripe-retrieve-subscription.test.ts
```

Expected: 7 tests PASS (6 reconcile + 1 Stripe retrieve).

- [ ] **7.3:** Run `pnpm --filter @jdm/api exec eslint src/workers/billing-reconcile.ts src/services/revenuecat/client.ts src/services/stripe/index.ts`. Expected: PASS.

- [ ] **7.4:** `git status` — confirm only these files modified/created:
  - `apps/api/src/env.ts`
  - `apps/api/src/services/revenuecat/client.ts`
  - `apps/api/src/services/stripe/index.ts`
  - `apps/api/src/workers/billing-reconcile.ts`
  - `apps/api/src/app.ts`
  - `apps/api/src/workers/billing-reconcile.test.ts`
  - `apps/api/test/billing/stripe-retrieve-subscription.test.ts`

  Per `feedback_no_full_test_suite_locally.md` — DO NOT run the full test suite locally.

- [ ] **7.5:** `git push -u origin feat/jdma-f8-billing-12`.

---

## PR checklist

**Branch:** `feat/jdma-f8-billing-12` from fresh `main` (NOT `production` — CLAUDE.md preflight).

**Commit subject (squash-merge title):**
`feat(api): hourly reconciliation sweep worker + RC REST client + Stripe retrieveSubscription (chunk F8.12)`

**PR body (required sections):**

### Summary

- Adds `apps/api/src/services/revenuecat/client.ts` — minimal RC REST `GET /v1/subscribers/{app_user_id}` client (`buildRevenueCatClient`, `RevenueCatClient` type, `RCSubscriber` shape).
- Extends `StripeClient` with `retrieveSubscription(subId)` wrapping `stripe.subscriptions.retrieve` with `items.data.price.product` expand.
- Adds `REVENUECAT_REST_API_KEY` (optional) + `RECONCILE_ALERT_DEPTH` (default 200) env vars to `apps/api/src/env.ts`.
- Introduces `apps/api/src/workers/billing-reconcile.ts` — hourly cron (`0 * * * *`); queries stale `PremiumMembership` rows (`status IN ('active','past_due','cancel_scheduled') AND currentPeriodEnd < now LIMIT 200`); per row: calls provider SDK/REST; synthesises a `BillingEvent` of kind `subscription.renewed` or `subscription.expired`; calls `applyMembershipEvent(tx, evt)` in a Prisma transaction (preserving §F8.4 atomicity); emits structured logs per transition; alerts when queue depth reaches threshold.
- Registers worker in `app.ts` behind `WORKER_ENABLED && GROWTH_PREMIUM_BILLING_ENABLED` guards.

### Test plan

- [x] `billing-reconcile.test.ts` (6 tests) — Testcontainers Postgres + mocked Stripe + mocked RC: no-op when no stale rows; Stripe drift recovery (missed renewal); Stripe expiry (sub canceled); RC drift recovery; alert on queue depth threshold; flag-disabled no-op.
- [x] `stripe-retrieve-subscription.test.ts` (1 test) — Stripe SDK mock; method resolves with id, status, current_period_end.
- [x] `pnpm --filter @jdm/api typecheck` green.
- [x] No full-suite local run (per `feedback_no_full_test_suite_locally.md`).

### Canon conformance

| Canon                           | Satisfied by                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| §F8.4 — activation tx atomicity | `applyMembershipEvent(tx, evt)` inside `prisma.$transaction`                                 |
| §F8.11 — feature flag           | `flagEnabled` field on `ReconcileTickDeps`; `app.ts` checks `GROWTH_PREMIUM_BILLING_ENABLED` |
| §F8.3 — max() snapshot rule     | Delegated to `applyMembershipEvent`; reconcile does not touch `Garage` directly              |
| §F8.12 — filtered test cmd      | `pnpm --filter @jdm/api exec vitest run src/workers/billing-reconcile.test.ts`               |

### Deviations from skeleton

1. `REVENUECAT_REST_API_KEY` is added to env in this chunk (F8.12) rather than F8.01 (F8.01 added `REVENUECAT_WEBHOOK_AUTH_HEADER` for the webhook route; the REST key is conceptually owned by the reconcile sweep). If F8.01 lands first and leaves a TODO for this key, the F8.12 author fills it in here.
2. Reconcile-synthesised `BillingEvent` uses a `reconcile:`-prefixed `providerInvoiceRef` to ensure idempotent re-runs. The F8.03 `applyMembershipEvent` must swallow `P2002` on invoice insert (same idempotency model as live webhooks — §F8.15). If F8.03 does not yet handle this, add the P2002 catch in that service.
3. `startReconcileWorker` accepts an explicit `rc: RevenueCatClient` dep (not built internally) to keep the factory side-effect-free and testable.

### Reads from / parallel-with

- Reads (must be merged): F8.01 (schema + env), F8.02 (`BillingEvent` types), F8.03 (`applyMembershipEvent`).
- Parallel-with: F8.04, F8.05 (webhook routes), F8.06, F8.07 (activation side-effects). All in Wave B/C — no code conflict.

### Reviewer focus

1. `reconcileStripeRow` and `reconcileRcRow` must NOT mutate DB directly — they only return a `BillingEvent`. All writes happen inside `applyMembershipEvent(tx, evt)`. Verify no `prisma.*` calls inside the helpers.
2. The `reconcile:` invoice ref prefix must be stable across re-runs for the same row — verify the ref is deterministic (provider sub ref + period end timestamp).
3. Worker is only registered under `env.WORKER_ENABLED && env.NODE_ENV === 'production'` (existing gate) AND `env.GROWTH_PREMIUM_BILLING_ENABLED` — verify both conditions present in `app.ts`.
4. `REVENUECAT_REST_API_KEY` optional — worker should warn but not crash when key is absent (RC rows will error per-row and log, not take the whole process down).
5. Cron pattern is `'0 * * * *'` (top of each hour) — not `'* * * * *'` (every minute, which is the reminder worker pattern).

---

## Self-review

**Spec coverage:**

- §6 query: `status IN ('active','past_due','cancel_scheduled') AND currentPeriodEnd < now LIMIT 200` — covered in `runReconcileTick` query (Task 5).
- §6 Stripe branch: `subscriptions.retrieve` + `active+period_end > now` → replay; `canceled/incomplete_expired/unpaid` → expired — covered by Tests 2 + 3 (Task 4/5).
- §6 RC branch: `getSubscriber` + entitlement expiry check — covered by Test 4.
- §6 alert on queue depth — covered by Test 5.
- §F8.11 flag gate — covered by Test 6.
- §F8.4 atomicity — all writes via `applyMembershipEvent(tx)` inside `prisma.$transaction`.
- §F8.3 max() rule — delegated to `applyMembershipEvent`; no separate assertion needed here (F8.03 owns that test).

**Placeholder scan:** no TBDs, no "handle edge cases" prose, no "similar to Task N" references. Every step has either code or an exact command.

**Type consistency:** `ReconcileTickDeps`, `runReconcileTick`, `startReconcileWorker`, `RevenueCatClient`, `buildRevenueCatClient`, `RCSubscriber` names used consistently across service file, test file, app.ts registration, and PR body.
