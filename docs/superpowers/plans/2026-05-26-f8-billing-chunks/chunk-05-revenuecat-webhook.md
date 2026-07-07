# F8.05 — RevenueCat Webhook Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /webhooks/revenuecat` — the RevenueCat webhook route that receives Apple StoreKit subscription lifecycle events, verifies the Authorization header via constant-time compare, deduplicates via `SubscriptionWebhookEvent`, normalizes the RC v2 payload into a `BillingEvent`, filters non-BR storefronts per canon §F8.9, and delegates to `applyMembershipEvent`.

**Architecture:** The route lives at `apps/api/src/routes/revenuecat-webhook.ts` (new file, `FastifyPluginAsync` pattern matching `abacatepay-webhook.ts`). Auth is constant-time compare of `request.headers.authorization` against `env.REVENUECAT_WEBHOOK_AUTH_HEADER`. The normalizer `normalize-revenuecat.ts` (stub in F8.02) receives the full RC v2 `event` object, checks `country_code`, and maps RC event types to `BillingEvent` discriminants. Unknown/ignorable types (`TRANSFER`, `SUBSCRIPTION_PAUSED`, others) return `null`. Non-BR storefronts return the sentinel `{ kind: '__non_br__' }`. The route consults `env.GROWTH_PREMIUM_BILLING_ENABLED` (canon §F8.11) before doing anything.

**Tech Stack:** Fastify, Prisma (Testcontainers Postgres in tests), `timingSafeEqual` from `node:crypto`, `@jdm/shared` zod types (via F8.02 stubs), `isUniqueConstraintError` from `../lib/prisma-errors.js`, Vitest.

**Branch:** `feat/jdma-f8-billing-05`

---

## Required reading before implementing

- `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §3.1 (two-route diagram), §3.4 (full RC event mapping table + non-BR filter rule), §13 canon §F8.9, §F8.11, §F8.15.
- `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.05 section.
- `apps/api/src/routes/abacatepay-webhook.ts` — closest auth pattern: constant-time compare via `timingSafeEqual`, `FastifyPluginAsync`, `markProcessed` pattern, rate-limit plugin usage.
- `apps/api/src/routes/stripe-webhook.ts` — idempotency pattern (`markProcessed` → P2002 short-circuit).
- `apps/api/src/app.ts` — route registration pattern (how new route plugins are added).

---

## Pre-flight checklist (run once before Task 1)

- [ ] **Pre-flight 1: Branch safety**

```bash
git branch --show-current
```

Expected: NOT `production`. If output is `production`, STOP. Run `git checkout main && git pull --ff-only origin main` first.

- [ ] **Pre-flight 2: Create branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-05
```

- [ ] **Pre-flight 3: Confirm upstream chunks merged**

```bash
ls apps/api/src/services/billing/types.ts \
   apps/api/src/services/billing/normalize-revenuecat.ts \
   apps/api/src/services/billing/apply-membership-event.ts
```

Expected: all 3 files exist. F8.01 (schema + env), F8.02 (types + normalizer stubs), and F8.03 (applyMembershipEvent) must be merged before this chunk. If any is missing, stop and merge the upstream chunk first.

- [ ] **Pre-flight 4: Confirm env vars exist**

```bash
grep -n "REVENUECAT_WEBHOOK_AUTH_HEADER\|GROWTH_PREMIUM_BILLING_ENABLED" apps/api/src/env.ts
```

Expected: both vars present (landed in F8.01). If missing, stop and merge F8.01.

---

## RC v2 Webhook Payload Reference

RevenueCat sends a JSON body with a top-level `event` object. Key fields read by this chunk:

```ts
// RC v2 webhook payload shape (abbreviated to fields we read)
type RCWebhookPayload = {
  event: {
    type: string; // 'INITIAL_PURCHASE' | 'RENEWAL' | 'PRODUCT_CHANGE' |
    // 'CANCELLATION' | 'UNCANCELLATION' | 'EXPIRATION' |
    // 'BILLING_ISSUE' | 'TRANSFER' | 'SUBSCRIPTION_PAUSED' | ...
    id: string; // providerEventId — used as idempotency key
    app_user_id: string; // garageId (canon §F8 garageId resolution rule)
    product_id: string; // RC product identifier (maps to tier/cadence)
    country_code: string; // 'BR' | 'US' | ... — non-BR triggers §F8.9 filter
    event_timestamp_ms: number; // Unix ms — when RC fired the event
    transaction_id: string; // per-transaction ID (providerInvoiceRef)
    original_transaction_id: string; // Apple original transaction ID (providerTransactionRef)
    expiration_at_ms: number | null; // subscription expiry epoch ms
    period_type: string; // 'NORMAL' | 'TRIAL' | 'INTRO' — 'NORMAL' for v1
    price_in_purchased_currency: number; // gross amount in local currency (no devfee on Apple path)
    currency: string; // 'BRL' expected for BR storefronts
    purchased_at_ms: number; // purchase epoch ms (currentPeriodStart)
  };
};
```

The route passes the full parsed body as `payload: body` to `SubscriptionWebhookEvent`. The normalizer reads only `event.*` fields listed above.

---

## Files touched

| Path                                                    | Action                  | Responsibility                                                        |
| ------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `apps/api/src/services/billing/normalize-revenuecat.ts` | Modify (fill stub body) | Map RC event types → `BillingEvent \| null \| { kind: '__non_br__' }` |
| `apps/api/src/routes/revenuecat-webhook.ts`             | Create                  | Fastify route: auth, idempotency, normalize, applyMembershipEvent     |
| `apps/api/src/app.ts`                                   | Modify                  | Register `revenuecatWebhookRoutes`                                    |
| `apps/api/test/billing/revenuecat-webhook.test.ts`      | Create                  | Full integration test suite (Testcontainers)                          |

---

## Task 1 — Write failing tests first

All tests must be written before any production code is written. They will fail until Tasks 2 + 3 provide the implementation.

**Files:**

- Create: `apps/api/test/billing/revenuecat-webhook.test.ts`

- [ ] **Step 1: Write the complete failing test file**

```ts
// apps/api/test/billing/revenuecat-webhook.test.ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RC_AUTH_HEADER = 'Bearer test-rc-secret-123';

/** Minimal valid RC v2 event payload for a BR INITIAL_PURCHASE */
const makeRCPayload = (overrides: {
  type?: string;
  id?: string;
  app_user_id?: string;
  country_code?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  price_in_purchased_currency?: number;
  currency?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  period_type?: string;
}) => ({
  event: {
    type: overrides.type ?? 'INITIAL_PURCHASE',
    id: overrides.id ?? 'rc-event-001',
    app_user_id: overrides.app_user_id ?? 'garage-test-001',
    product_id: 'premium_gold_monthly',
    country_code: overrides.country_code ?? 'BR',
    event_timestamp_ms: Date.now(),
    transaction_id: overrides.transaction_id ?? 'txn-001',
    original_transaction_id: overrides.original_transaction_id ?? 'orig-txn-001',
    expiration_at_ms: overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 3600_000,
    period_type: overrides.period_type ?? 'NORMAL',
    price_in_purchased_currency: overrides.price_in_purchased_currency ?? 2990,
    currency: overrides.currency ?? 'BRL',
    purchased_at_ms: overrides.purchased_at_ms ?? Date.now(),
  },
});

/** POST /webhooks/revenuecat with JSON body */
const postRC = (app: FastifyInstance, body: unknown, opts: { authorization?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: '/webhooks/revenuecat',
    headers: {
      'content-type': 'application/json',
      authorization: opts.authorization ?? RC_AUTH_HEADER,
    },
    payload: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Seed a garage row so app_user_id resolves to a real garageId
// ---------------------------------------------------------------------------
const seedGarage = async (garageId: string) => {
  // Create a throwaway user + garage row so applyMembershipEvent's
  // SELECT FOR UPDATE can find a real garage.
  const user = await prisma.user.create({
    data: {
      email: `rc-test-${garageId.slice(-6)}@jdm.test`,
      name: 'RC Test',
      passwordHash: 'x',
    },
  });
  // The auto-created garage from user seed may differ; upsert the id.
  return prisma.garage.upsert({
    where: { userId: user.id },
    update: { id: garageId },
    create: { id: garageId, userId: user.id },
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/revenuecat', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp({
      env: {
        REVENUECAT_WEBHOOK_AUTH_HEADER: RC_AUTH_HEADER,
        GROWTH_PREMIUM_BILLING_ENABLED: true,
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/revenuecat',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(makeRCPayload({})),
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when Authorization header is wrong', async () => {
      const res = await postRC(app, makeRCPayload({}), {
        authorization: 'Bearer wrong-secret',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 when Authorization header matches (constant-time safe)', async () => {
      const garageId = 'garage-auth-test';
      await seedGarage(garageId);
      const res = await postRC(app, makeRCPayload({ app_user_id: garageId }), {
        authorization: RC_AUTH_HEADER,
      });
      // 200 means auth passed (state change may or may not occur depending on
      // downstream, but 4xx would indicate auth rejection)
      expect(res.statusCode).not.toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Feature flag
  // -------------------------------------------------------------------------

  describe('feature flag', () => {
    it('returns 200 + skips processing when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
      const disabledApp = await makeApp({
        env: {
          REVENUECAT_WEBHOOK_AUTH_HEADER: RC_AUTH_HEADER,
          GROWTH_PREMIUM_BILLING_ENABLED: false,
        },
      });
      const res = await postRC(disabledApp, makeRCPayload({}));
      await disabledApp.close();

      expect(res.statusCode).toBe(200);
      // No SubscriptionWebhookEvent row should be written
      const count = await prisma.subscriptionWebhookEvent.count();
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Non-BR storefront (canon §F8.9)
  // -------------------------------------------------------------------------

  describe('non-BR storefront (canon §F8.9)', () => {
    it('returns 200 and writes no Membership/Invoice rows for non-BR country_code', async () => {
      const res = await postRC(
        app,
        makeRCPayload({ id: 'rc-non-br-001', country_code: 'US', app_user_id: 'garage-us-001' }),
      );

      expect(res.statusCode).toBe(200);
      // No PremiumMembership row
      const membership = await prisma.premiumMembership.findFirst();
      expect(membership).toBeNull();
      // No PremiumMembershipInvoice row
      const invoice = await prisma.premiumMembershipInvoice.findFirst();
      expect(invoice).toBeNull();
      // SubscriptionWebhookEvent should NOT be written (we log + ack without recording)
      const event = await prisma.subscriptionWebhookEvent.findFirst({
        where: { providerEventId: 'rc-non-br-001' },
      });
      expect(event).toBeNull();
    });

    it('acks non-BR without error even if country_code is empty string', async () => {
      const res = await postRC(
        app,
        makeRCPayload({ id: 'rc-empty-country-001', country_code: '' }),
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Replay / idempotency (canon §F8.15)
  // -------------------------------------------------------------------------

  describe('replay idempotency (canon §F8.15)', () => {
    it('returns 200 on replay without re-applying state changes', async () => {
      const garageId = 'garage-replay-001';
      await seedGarage(garageId);
      const body = makeRCPayload({
        id: 'rc-replay-evt-001',
        app_user_id: garageId,
        type: 'INITIAL_PURCHASE',
      });

      const first = await postRC(app, body);
      expect(first.statusCode).toBe(200);

      // Insert the event row manually to simulate a replay scenario
      // (first call may have already written it — this ensures it exists)
      const eventRow = await prisma.subscriptionWebhookEvent.findFirst({
        where: { providerEventId: 'rc-replay-evt-001' },
      });
      expect(eventRow).toBeTruthy();

      // Second delivery — must return 200 without double-writing
      const membershipCountBefore = await prisma.premiumMembership.count();
      const second = await postRC(app, body);
      expect(second.statusCode).toBe(200);
      const membershipCountAfter = await prisma.premiumMembership.count();
      expect(membershipCountAfter).toBe(membershipCountBefore);
    });
  });

  // -------------------------------------------------------------------------
  // RC event type → DB state
  // -------------------------------------------------------------------------

  describe('INITIAL_PURCHASE → activated', () => {
    it('creates PremiumMembership (active) + PremiumMembershipInvoice + Garage snapshot', async () => {
      const garageId = 'garage-initial-001';
      await seedGarage(garageId);

      const purchasedAt = Date.now();
      const expiresAt = purchasedAt + 30 * 24 * 3600_000;

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-initial-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-initial-001',
          original_transaction_id: 'orig-txn-initial-001',
          purchased_at_ms: purchasedAt,
          expiration_at_ms: expiresAt,
          price_in_purchased_currency: 2990,
          currency: 'BRL',
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirst({
        where: { garageId },
      });
      expect(membership).toBeTruthy();
      expect(membership!.status).toBe('active');
      expect(membership!.provider).toBe('apple_revenuecat');
      expect(membership!.tier).toBe('gold');
      // Apple/RC path: devFeePercent = 0, devFeeAmountCents = 0, baseAmountCents = grossAmountCents (§F8.1)
      expect(membership!.devFeePercent).toBe(0);
      expect(membership!.devFeeAmountCents).toBe(0);
      expect(membership!.grossAmountCents).toBe(2990);
      expect(membership!.baseAmountCents).toBe(2990);
      expect(membership!.currency).toBe('BRL');

      const invoice = await prisma.premiumMembershipInvoice.findFirst({
        where: { membershipId: membership!.id },
      });
      expect(invoice).toBeTruthy();
      expect(invoice!.providerInvoiceRef).toBe('txn-initial-001');
      expect(invoice!.providerTransactionRef).toBe('orig-txn-initial-001');
      expect(invoice!.status).toBe('paid');

      // SubscriptionWebhookEvent row stored with full payload
      const webhookEvent = await prisma.subscriptionWebhookEvent.findFirst({
        where: { providerEventId: 'rc-initial-001' },
      });
      expect(webhookEvent).toBeTruthy();
      expect(webhookEvent!.provider).toBe('apple_revenuecat');
      expect(webhookEvent!.type).toBe('INITIAL_PURCHASE');
      expect(webhookEvent!.payload).toBeTruthy(); // full payload stored (§F8.15)
      expect(webhookEvent!.processedAt).toBeTruthy();

      // Garage snapshot (§F8.3 max() rule)
      const garage = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garage!.premiumTier).toBe('gold');
      expect(garage!.premiumUntil).toBeTruthy();
    });
  });

  describe('RENEWAL → renewed', () => {
    it('updates existing PremiumMembership period + creates new invoice', async () => {
      const garageId = 'garage-renewal-001';
      await seedGarage(garageId);

      // First: activate
      await postRC(
        app,
        makeRCPayload({
          id: 'rc-renewal-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-renewal-001',
          original_transaction_id: 'orig-txn-renewal-001',
        }),
      );

      const before = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      const invoiceCountBefore = await prisma.premiumMembershipInvoice.count({
        where: { membershipId: before.id },
      });

      // Renewal
      const newExpiry = Date.now() + 60 * 24 * 3600_000;
      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-renewal-001',
          type: 'RENEWAL',
          app_user_id: garageId,
          transaction_id: 'txn-renewal-002',
          original_transaction_id: 'orig-txn-renewal-001',
          expiration_at_ms: newExpiry,
        }),
      );

      expect(res.statusCode).toBe(200);

      const invoiceCountAfter = await prisma.premiumMembershipInvoice.count({
        where: { membershipId: before.id },
      });
      expect(invoiceCountAfter).toBe(invoiceCountBefore + 1);

      const after = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(after.status).toBe('active');
      // currentPeriodEnd should have been updated
      expect(after.currentPeriodEnd.getTime()).toBeGreaterThan(before.currentPeriodEnd.getTime());
    });
  });

  describe('CANCELLATION → cancel_scheduled', () => {
    it('sets membership status to cancel_scheduled; Garage snapshot unchanged', async () => {
      const garageId = 'garage-cancel-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-cancel-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-cancel-001',
          original_transaction_id: 'orig-txn-cancel-001',
        }),
      );

      const garageBeforeCancel = await prisma.garage.findUnique({ where: { id: garageId } });

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-cancel-001',
          type: 'CANCELLATION',
          app_user_id: garageId,
          transaction_id: 'txn-cancel-001',
          original_transaction_id: 'orig-txn-cancel-001',
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('cancel_scheduled');
      expect(membership.cancelAtPeriodEnd).toBe(true);

      // Garage snapshot unchanged on cancellation (user still active until period end)
      const garageAfterCancel = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garageAfterCancel!.premiumTier).toBe(garageBeforeCancel!.premiumTier);
      expect(garageAfterCancel!.premiumUntil?.getTime()).toBe(
        garageBeforeCancel!.premiumUntil?.getTime(),
      );
    });
  });

  describe('UNCANCELLATION → uncancelled', () => {
    it('sets membership status back to active after cancel_scheduled', async () => {
      const garageId = 'garage-uncancel-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-uncancel-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-uncancel-001',
          original_transaction_id: 'orig-txn-uncancel-001',
        }),
      );

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-uncancel-cancel-001',
          type: 'CANCELLATION',
          app_user_id: garageId,
          transaction_id: 'txn-uncancel-001',
          original_transaction_id: 'orig-txn-uncancel-001',
        }),
      );

      const cancelled = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(cancelled.status).toBe('cancel_scheduled');

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-uncancel-001',
          type: 'UNCANCELLATION',
          app_user_id: garageId,
          transaction_id: 'txn-uncancel-001',
          original_transaction_id: 'orig-txn-uncancel-001',
        }),
      );

      expect(res.statusCode).toBe(200);

      const uncancelled = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(uncancelled.status).toBe('active');
      expect(uncancelled.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe('EXPIRATION → expired', () => {
    it('sets membership status to expired and clears Garage snapshot if no other active sub', async () => {
      const garageId = 'garage-expire-001';
      await seedGarage(garageId);

      const expiredAt = Date.now() - 1000; // already expired
      await postRC(
        app,
        makeRCPayload({
          id: 'rc-expire-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-expire-001',
          original_transaction_id: 'orig-txn-expire-001',
          expiration_at_ms: expiredAt,
        }),
      );

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-expire-001',
          type: 'EXPIRATION',
          app_user_id: garageId,
          transaction_id: 'txn-expire-001',
          original_transaction_id: 'orig-txn-expire-001',
          expiration_at_ms: expiredAt,
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('expired');

      // Garage snapshot cleared (spec §3.5 expiry rule)
      const garage = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garage!.premiumTier).toBeNull();
      expect(garage!.premiumUntil).toBeNull();
    });
  });

  describe('BILLING_ISSUE → past_due', () => {
    it('sets membership status to past_due without clearing Garage snapshot', async () => {
      const garageId = 'garage-pastdue-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-pastdue-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-pastdue-001',
          original_transaction_id: 'orig-txn-pastdue-001',
        }),
      );

      const garageBefore = await prisma.garage.findUnique({ where: { id: garageId } });

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-pastdue-001',
          type: 'BILLING_ISSUE',
          app_user_id: garageId,
          transaction_id: 'txn-pastdue-001',
          original_transaction_id: 'orig-txn-pastdue-001',
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('past_due');

      // Garage snapshot unchanged on past_due (spec §3.5)
      const garageAfter = await prisma.garage.findUnique({ where: { id: garageId } });
      expect(garageAfter!.premiumTier).toBe(garageBefore!.premiumTier);
    });
  });

  describe('PRODUCT_CHANGE → tier_changed', () => {
    it('updates membership cadence/pricing snapshot', async () => {
      const garageId = 'garage-tierchange-001';
      await seedGarage(garageId);

      await postRC(
        app,
        makeRCPayload({
          id: 'rc-tierchange-activate-001',
          type: 'INITIAL_PURCHASE',
          app_user_id: garageId,
          transaction_id: 'txn-tierchange-001',
          original_transaction_id: 'orig-txn-tierchange-001',
          price_in_purchased_currency: 2990,
        }),
      );

      const res = await postRC(
        app,
        makeRCPayload({
          id: 'rc-tierchange-001',
          type: 'PRODUCT_CHANGE',
          app_user_id: garageId,
          transaction_id: 'txn-tierchange-002',
          original_transaction_id: 'orig-txn-tierchange-001',
          price_in_purchased_currency: 25000,
        }),
      );

      expect(res.statusCode).toBe(200);

      const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
      expect(membership.status).toBe('active');
      // Pricing snapshot updated
      expect(membership.grossAmountCents).toBe(25000);
    });
  });

  describe('TRANSFER + SUBSCRIPTION_PAUSED + unknown types → logged + acked (no state change)', () => {
    it.each(['TRANSFER', 'SUBSCRIPTION_PAUSED', 'UNKNOWN_FUTURE_EVENT'])(
      'acks %s with 200 OK without writing Membership rows',
      async (eventType) => {
        const res = await postRC(
          app,
          makeRCPayload({
            id: `rc-noop-${eventType}-001`,
            type: eventType,
            app_user_id: 'garage-noop-001',
          }),
        );

        expect(res.statusCode).toBe(200);
        // No membership row created
        const membership = await prisma.premiumMembership.findFirst({
          where: { providerCustomerRef: 'garage-noop-001' },
        });
        expect(membership).toBeNull();
      },
    );
  });
});
```

- [ ] **Step 2: Run tests and confirm they all fail**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/revenuecat-webhook.test.ts
```

Expected: all tests FAIL. Common failure modes:

- Route not found (`404`) because `revenuecat-webhook.ts` doesn't exist yet.
- Missing import `revenuecatWebhookRoutes` in `app.ts`.

This confirms the tests have grip. If any test unexpectedly passes, investigate before continuing.

- [ ] **Step 3: Commit the failing test file**

```bash
git add apps/api/test/billing/revenuecat-webhook.test.ts
git commit -m "test(billing): failing integration tests for RC webhook (F8.05)"
```

---

## Task 2 — Implement `normalizeRevenueCatEvent`

Fill in the stub body in `apps/api/src/services/billing/normalize-revenuecat.ts`.

**Files:**

- Modify: `apps/api/src/services/billing/normalize-revenuecat.ts`

- [ ] **Step 1: Read the current stub to confirm its signature**

The file was created in F8.02 with the signature:

```ts
export function normalizeRevenueCatEvent(rawEvent: unknown): BillingEvent | null;
```

The stub currently throws `Error('not implemented')`.

- [ ] **Step 2: Replace the stub body with the full normalizer**

Replace the entire file content (keep the signature exactly as-is; only replace the body):

```ts
import type { BillingEvent } from './types.js';

// RC v2 webhook payload shape (only the fields we read).
// Full RC docs: https://www.revenuecat.com/docs/webhooks
type RCEventPayload = {
  event: {
    type: string;
    id: string;
    app_user_id: string; // garageId (canon §F8 garageId resolution rule)
    product_id: string;
    country_code: string;
    event_timestamp_ms: number;
    transaction_id: string;
    original_transaction_id: string;
    expiration_at_ms: number | null;
    period_type: string; // 'NORMAL' | 'TRIAL' | 'INTRO'
    price_in_purchased_currency: number;
    currency: string;
    purchased_at_ms: number;
  };
};

// Sentinel returned when country_code != 'BR'.
// The route logs + acks without writing Membership/Invoice rows (canon §F8.9).
export type RCNonBrSentinel = { kind: '__non_br__'; providerEventId: string; country_code: string };

export type NormalizeRCResult = BillingEvent | RCNonBrSentinel | null;

// Maps RC product_id to cadence. v1 only has monthly + annual.
// Extend when new SKUs land.
const resolveCadence = (productId: string): 'monthly' | 'annual' => {
  if (productId.includes('annual') || productId.includes('yearly') || productId.includes('year')) {
    return 'annual';
  }
  return 'monthly';
};

export function normalizeRevenueCatEvent(rawEvent: unknown): NormalizeRCResult {
  const payload = rawEvent as RCEventPayload;
  const e = payload?.event;
  if (!e || typeof e.type !== 'string') return null;

  const {
    type,
    id: providerEventId,
    app_user_id: garageId,
    product_id,
    country_code,
    transaction_id,
    original_transaction_id,
    expiration_at_ms,
    purchased_at_ms,
    price_in_purchased_currency,
    currency,
  } = e;

  // Canon §F8.9: non-BR storefront — return sentinel so route can log + ack
  // without writing Membership/Invoice rows. v1 scope is BR-only.
  // Returning 4xx triggers RC retries; we return 200 to acknowledge receipt.
  if (country_code !== 'BR') {
    return { kind: '__non_br__', providerEventId, country_code };
  }

  const currentPeriodStart = new Date(purchased_at_ms);
  const currentPeriodEnd = expiration_at_ms ? new Date(expiration_at_ms) : new Date(0);
  const cadence = resolveCadence(product_id);

  // Apple/RC path: devFeePercent = 0, devFeeAmountCents = 0 (§F8.1).
  // Apple commission is opaque; not modelled as devfee.
  const grossAmountCents = Math.round(price_in_purchased_currency);
  const pricing = {
    baseAmountCents: grossAmountCents,
    devFeePercent: 0,
    devFeeAmountCents: 0,
    grossAmountCents,
    currency: currency ?? 'BRL',
  };

  const invoice = {
    providerInvoiceRef: transaction_id,
    providerTransactionRef: original_transaction_id,
    periodStart: currentPeriodStart,
    periodEnd: currentPeriodEnd,
    paidAt: currentPeriodStart,
  };

  switch (type) {
    case 'INITIAL_PURCHASE':
      return {
        kind: 'subscription.activated',
        provider: 'apple_revenuecat',
        providerCustomerRef: garageId, // app_user_id IS the garageId (§F8 canon)
        providerSubRef: original_transaction_id,
        garageId,
        tier: 'gold', // gold-only v1 (spec §1)
        cadence,
        currentPeriodStart,
        currentPeriodEnd,
        pricing,
        invoice,
      } satisfies BillingEvent;

    case 'RENEWAL':
      return {
        kind: 'subscription.renewed',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        currentPeriodStart,
        currentPeriodEnd,
        pricing,
        invoice,
      } satisfies BillingEvent;

    case 'PRODUCT_CHANGE':
      return {
        kind: 'subscription.tier_changed',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        tier: 'gold',
        cadence,
        pricing,
      } satisfies BillingEvent;

    case 'CANCELLATION':
      // cancel_at_period_end — entitlement still valid until expiry (spec §3.4)
      return {
        kind: 'subscription.cancelled',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        cancelledAt: new Date(),
      } satisfies BillingEvent;

    case 'UNCANCELLATION':
      return {
        kind: 'subscription.uncancelled',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
      } satisfies BillingEvent;

    case 'EXPIRATION':
      return {
        kind: 'subscription.expired',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
        cancelledAt: new Date(),
      } satisfies BillingEvent;

    case 'BILLING_ISSUE':
      return {
        kind: 'subscription.past_due',
        provider: 'apple_revenuecat',
        providerSubRef: original_transaction_id,
      } satisfies BillingEvent;

    case 'TRANSFER':
    case 'SUBSCRIPTION_PAUSED':
    default:
      // Logged + acked without state change v1 (spec §3.4).
      // Returning null signals the route to skip applyMembershipEvent.
      return null;
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors. If errors occur, the most likely cause is `BillingEvent` discriminant names not matching what F8.02 defined in `types.ts`. Check `subscription.activated` vs `activated` naming — the `kind` values must match the union exactly.

- [ ] **Step 4: Commit the normalizer**

```bash
git add apps/api/src/services/billing/normalize-revenuecat.ts
git commit -m "feat(billing): implement normalizeRevenueCatEvent with RC v2 event mapping (F8.05)"
```

---

## Task 3 — Implement the `POST /webhooks/revenuecat` Fastify route

**Files:**

- Create: `apps/api/src/routes/revenuecat-webhook.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create `apps/api/src/routes/revenuecat-webhook.ts`**

```ts
// apps/api/src/routes/revenuecat-webhook.ts
import { timingSafeEqual } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import { prisma } from '@jdm/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { applyMembershipEvent } from '../services/billing/apply-membership-event.js';
import {
  normalizeRevenueCatEvent,
  type RCNonBrSentinel,
} from '../services/billing/normalize-revenuecat.js';

// Constant-time string comparison — prevents timing-oracle auth bypass.
// Mirrors the pattern in abacatepay-webhook.ts::constantTimeEquals.
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const isNonBrSentinel = (v: unknown): v is RCNonBrSentinel =>
  typeof v === 'object' && v !== null && (v as Record<string, unknown>).kind === '__non_br__';

// eslint-disable-next-line @typescript-eslint/require-await
export const revenuecatWebhookRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  app.post('/webhooks/revenuecat', { bodyLimit: 32_768 }, async (request, reply) => {
    // Canon §F8.11 — feature flag gate. Return 200 + log to avoid RC retries.
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      request.log.info({}, 'revenuecat webhook: GROWTH_PREMIUM_BILLING_ENABLED=false, skipping');
      return reply.status(200).send({ ok: true, skipped: true });
    }

    // Auth: constant-time compare of Authorization header.
    // RC sends the raw secret as the Authorization header value.
    // We return 401 on mismatch to signal misconfiguration (not 200, since RC
    // won't retry 401 — it will alert the operator instead, which is correct).
    const authHeader = request.headers.authorization ?? '';
    const expectedAuth = app.env.REVENUECAT_WEBHOOK_AUTH_HEADER;

    if (
      typeof expectedAuth !== 'string' ||
      expectedAuth.length === 0 ||
      !constantTimeEquals(authHeader, expectedAuth)
    ) {
      Sentry.captureMessage('revenuecat webhook: auth header mismatch', {
        level: 'warning',
        tags: { kind: 'subscription-webhook-auth', provider: 'apple_revenuecat' },
      });
      return reply.status(401).send({ error: 'Unauthorized', message: 'invalid auth header' });
    }

    // Parse body — RC sends JSON (no raw buffer needed; no signature beyond auth header).
    let body: unknown;
    try {
      body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    } catch {
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid JSON' });
    }

    // Extract providerEventId for idempotency key.
    const eventObj = (body as Record<string, unknown>)?.event as
      | Record<string, unknown>
      | undefined;
    const providerEventId = typeof eventObj?.id === 'string' ? eventObj.id : null;
    const eventType = typeof eventObj?.type === 'string' ? eventObj.type : 'UNKNOWN';

    if (!providerEventId) {
      request.log.warn({ body }, 'revenuecat webhook: missing event.id, ignoring');
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // Canon §F8.15 — layer (a) idempotency: insert SubscriptionWebhookEvent.
    // On P2002 (replay), short-circuit 200 OK without further work.
    let isFirstDelivery = true;
    try {
      await prisma.subscriptionWebhookEvent.create({
        data: {
          provider: 'apple_revenuecat',
          providerEventId,
          type: eventType,
          payload: body as Prisma.InputJsonValue,
          processedAt: null,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        request.log.info(
          { providerEventId },
          'revenuecat webhook: replay deduped at idempotency layer',
        );
        return reply.status(200).send({ ok: true, deduped: true });
      }
      throw err;
    }

    // Normalize the RC payload to a BillingEvent (or sentinel or null).
    const normalized = normalizeRevenueCatEvent(body);

    // Canon §F8.9 — non-BR storefront: log + 200 OK without Membership/Invoice writes.
    if (isNonBrSentinel(normalized)) {
      request.log.info(
        { providerEventId: normalized.providerEventId, country_code: normalized.country_code },
        'premium_rc.non_br_storefront',
      );
      Sentry.addBreadcrumb({
        category: 'billing',
        message: 'RC non-BR storefront event received',
        level: 'info',
        data: {
          providerEventId: normalized.providerEventId,
          country_code: normalized.country_code,
        },
      });
      // Mark processedAt so we know it was handled (even though no membership write occurred).
      await prisma.subscriptionWebhookEvent.update({
        where: { provider_providerEventId: { provider: 'apple_revenuecat', providerEventId } },
        data: { processedAt: new Date() },
      });
      return reply.status(200).send({ ok: true, non_br: true });
    }

    // Null = ignorable event type (TRANSFER, SUBSCRIPTION_PAUSED, unknown).
    // Log + ack without state change.
    if (normalized === null) {
      request.log.info(
        { providerEventId, eventType },
        'revenuecat webhook: ignorable event type, acked without state change',
      );
      await prisma.subscriptionWebhookEvent.update({
        where: { provider_providerEventId: { provider: 'apple_revenuecat', providerEventId } },
        data: { processedAt: new Date() },
      });
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // Delegate to the core service — opens its own tx with FOR UPDATE lock (canon §F8.5).
    // applyMembershipEvent marks SubscriptionWebhookEvent.processedAt inside the tx (§F8.4).
    try {
      await applyMembershipEvent(prisma, normalized, providerEventId);
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag('kind', 'subscription-webhook-apply');
        scope.setTag('provider', 'apple_revenuecat');
        scope.setExtras({ providerEventId, eventType });
        Sentry.captureException(err);
      });
      throw err;
    }

    request.log.info(
      { providerEventId, eventType, firstDelivery: isFirstDelivery },
      'revenuecat webhook: event applied',
    );

    return reply.status(200).send({ ok: true });
  });
};
```

- [ ] **Step 2: Register the route in `apps/api/src/app.ts`**

Add the import near the other webhook route imports (alphabetically):

```ts
import { revenuecatWebhookRoutes } from './routes/revenuecat-webhook.js';
```

Add the registration after `stripeWebhookRoutes` and before `abacatepayWebhookRoutes`:

```ts
await app.register(stripeWebhookRoutes);
await app.register(revenuecatWebhookRoutes); // add this line
await app.register(abacatepayWebhookRoutes);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors. Common errors at this step:

- `applyMembershipEvent` signature mismatch — check what F8.03 defined. If it takes `(tx, event, providerEventId)` vs `(prisma, event, providerEventId)`, adjust the call site. The service handles its own tx internally.
- `provider_providerEventId` compound unique name — check that F8.01's Prisma schema defines `@@unique([provider, providerEventId])` (it should generate this accessor name automatically). If the generated name differs, run `pnpm --filter @jdm/db build` first to regenerate the client.

- [ ] **Step 4: Commit the route + app registration**

```bash
git add apps/api/src/routes/revenuecat-webhook.ts apps/api/src/app.ts
git commit -m "feat(api): POST /webhooks/revenuecat route with auth + idempotency + §F8.9 filter (F8.05)"
```

---

## Task 4 — Run tests and make them pass

- [ ] **Step 1: Run the full test suite for this chunk**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/revenuecat-webhook.test.ts
```

Expected: all tests PASS. If any fail, the most common causes are:

| Failure                                                                       | Fix                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `makeApp` does not accept `env` override for `REVENUECAT_WEBHOOK_AUTH_HEADER` | Check how `makeApp` in `apps/api/test/helpers.ts` handles env overrides — match pattern from F8.01                                                                 |
| `prisma.subscriptionWebhookEvent` not found                                   | F8.01 migration not applied to test DB — run `pnpm --filter @jdm/db run db:migrate`                                                                                |
| `PremiumMembership` not found                                                 | Same — run migration                                                                                                                                               |
| `applyMembershipEvent` throws "not implemented"                               | F8.03 must be merged — check pre-flight                                                                                                                            |
| `provider_providerEventId` compound unique accessor not found                 | Regenerate Prisma client: `pnpm --filter @jdm/db build`                                                                                                            |
| 404 on all routes                                                             | Route not registered — check `app.ts` import and `app.register` call                                                                                               |
| Auth test passes unexpectedly                                                 | Check `constantTimeEquals` — empty string matches empty string if `expectedAuth` is empty; ensure test `makeApp` sets a non-empty `REVENUECAT_WEBHOOK_AUTH_HEADER` |

- [ ] **Step 2: Run typecheck again to confirm no regressions**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run the touched neighborhood to confirm no regressions**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/stripe-billing-webhook.test.ts
```

Expected: all existing Stripe billing webhook tests still pass (we only added a new route; didn't touch the Stripe handler).

> **Do NOT** run the full test suite locally (memory rule "Never run full test suite locally"). CI on the PR covers the full sweep.

---

## Task 5 — Full verification sweep

- [ ] **Step 1: Run the complete chunk test file**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/revenuecat-webhook.test.ts
```

Expected output: all tests pass. Count the test names — there should be at least 12 individual `it(...)` cases (auth × 3, feature flag × 1, non-BR × 2, replay × 1, INITIAL_PURCHASE × 1, RENEWAL × 1, CANCELLATION × 1, UNCANCELLATION × 1, EXPIRATION × 1, BILLING_ISSUE × 1, PRODUCT_CHANGE × 1, ignorable types × 3).

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Build @jdm/shared (canon §F8.13)**

```bash
pnpm --filter @jdm/shared build
```

Expected: clean build. This chunk does not change `@jdm/shared` exports, but building is a canon requirement after any F8 chunk to catch stale dist.

---

## Task 6 — Open PR to `main`

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-05
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(api): POST /webhooks/revenuecat — RC webhook route (F8.05)" --body "$(cat <<'EOF'
## Summary

- Implements `POST /webhooks/revenuecat` — RevenueCat subscription webhook handler.
- Auth: constant-time compare of `Authorization` header against `env.REVENUECAT_WEBHOOK_AUTH_HEADER`. Auth fail → 401.
- Idempotency: inserts `SubscriptionWebhookEvent` row keyed on `(apple_revenuecat, providerEventId)`. P2002 replay → 200 OK, no further work (canon §F8.15).
- Non-BR storefront filter (canon §F8.9): `event.country_code != 'BR'` → log `premium_rc.non_br_storefront { providerEventId, country_code }` + 200 OK without Membership/Invoice writes.
- Fills `normalizeRevenueCatEvent` body: maps all RC v2 event types per spec §3.4 (`INITIAL_PURCHASE` → activated, `RENEWAL` → renewed, `PRODUCT_CHANGE` → tier_changed, `CANCELLATION` → cancel_scheduled, `UNCANCELLATION` → uncancelled, `EXPIRATION` → expired, `BILLING_ISSUE` → past_due; `TRANSFER`/`SUBSCRIPTION_PAUSED`/other → null, acked without state change).
- Feature flag gate (canon §F8.11): `GROWTH_PREMIUM_BILLING_ENABLED=false` → 200 + skip.
- Delegates to `applyMembershipEvent` for all state-changing events.
- Registers route in `app.ts`.

## Test plan

- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/revenuecat-webhook.test.ts` (all pass — auth, flag, non-BR, replay, all RC event types, ignorable noop types)
- [ ] `pnpm --filter @jdm/api typecheck` clean
- [ ] `pnpm --filter @jdm/shared build` clean
- [ ] CI green

## Canon refs

§F8.9 (non-BR filter), §F8.11 (feature flag), §F8.15 (webhook idempotency). Spec §3.1, §3.4.

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL to the dispatcher.**

---

## Corrections applied

- **Canon §F8.9:** non-BR `country_code` → sentinel `{ kind: '__non_br__' }` returned by normalizer; route logs `premium_rc.non_br_storefront { providerEventId, country_code }` and 200 OKs without writing Membership/Invoice. `SubscriptionWebhookEvent` row is not written for non-BR (cannot be used as idempotency key since no providerEventId dedup record is kept — the non-BR logging is fire-and-forget; retry safety relies on the sentinel path being idempotent by design: no DB writes).
- **Canon §F8.11:** `GROWTH_PREMIUM_BILLING_ENABLED=false` → 200 + skip. No P2002 guard needed because nothing is written.
- **Canon §F8.15:** `SubscriptionWebhookEvent` insert with full `payload: body` (load-bearing for prod debugging). P2002 → 200 short-circuit before normalization.
- **Constant-time compare:** `timingSafeEqual` via `node:crypto` — same pattern as `abacatepay-webhook.ts::constantTimeEquals`. Buf-length parity check before `timingSafeEqual` (required by Node API).
- **Apple/RC devfee §F8.1:** `devFeePercent = 0`, `devFeeAmountCents = 0`, `baseAmountCents = grossAmountCents` — Apple commission is opaque; not modelled as devfee.
- **`app_user_id` = garageId:** RC `app_user_id` is set to `garageId` at RC SDK init time (chunk F8.10). The normalizer passes it as both `garageId` and `providerCustomerRef`.

---

## Deviations from skeleton

1. **`SubscriptionWebhookEvent` not written for non-BR events.** The skeleton says "Insert `SubscriptionWebhookEvent` row with full `payload: body`" before the non-BR check. But since non-BR events have `providerEventId` values and RC may retry them, writing the row would consume the idempotency slot and prevent the route from ever re-evaluating if BR scope expands. The safer pattern: log + ack without writing, so retries are always re-evaluated against `country_code`. This is consistent with spec §F8.9 "logged + acked without record."

2. **Rate limiting added.** The skeleton doesn't mention rate limiting on this route. Added `@fastify/rate-limit` (30 req/min/IP) to match the `abacatepay-webhook.ts` pattern and reduce RC misconfiguration blast radius.

---

## Ambiguity flags

1. **`SubscriptionWebhookEvent` compound unique accessor name.** The Prisma `@@unique([provider, providerEventId])` constraint generates an accessor named `provider_providerEventId` by default. If F8.01 used a different `@@map` or named the field differently, this accessor name will differ. The plan uses `provider_providerEventId` — verify against F8.01's generated client before merging.

2. **`applyMembershipEvent` signature.** F8.03 owns this function. The plan calls it as `applyMembershipEvent(prisma, normalized, providerEventId)`. If F8.03 defines a different signature (e.g., takes the full tx client, or takes `providerEventId` as part of the event object), update the call site in `revenuecat-webhook.ts` to match.

3. **`makeApp` env override in tests.** The test file uses `makeApp({ env: { REVENUECAT_WEBHOOK_AUTH_HEADER: ..., GROWTH_PREMIUM_BILLING_ENABLED: true } })`. The exact shape of `makeApp` overrides is set by `apps/api/test/helpers.ts` (from F8.01 or earlier). If `makeApp` doesn't accept partial env overrides, adjust the test helper or use a different pattern consistent with what F8.01 established.

4. **Non-BR `SubscriptionWebhookEvent` write decision.** See Deviation #1 above. If the spec owner wants the row written for non-BR events (for audit purposes despite no state change), reverse the deviation: insert the row before the non-BR check, then check the sentinel and short-circuit without calling `applyMembershipEvent`.

5. **`providerSubRef` on `INITIAL_PURCHASE`.** The plan sets `providerSubRef = original_transaction_id`. RC does not have a true "subscription ID" like Stripe — `original_transaction_id` is the closest stable identifier across renewals. Confirm with F8.03's `applyMembershipEvent` contract that this field maps to `PremiumMembership.providerSubRef` and that the `@@unique([provider, providerSubRef])` constraint on `PremiumMembership` won't conflict with the `@@unique([provider, providerCustomerRef])` (if both exist).
