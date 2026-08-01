# F8.04 — Stripe Billing Webhook Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST /webhooks/stripe-billing` — a Fastify route that verifies Stripe signatures, deduplicates via `SubscriptionWebhookEvent`, normalizes Stripe subscription events into `BillingEvent` via `normalizeStripeEvent`, dispatches to `applyMembershipEvent`, and handles `charge.refunded` to flip invoice status only (canon §F8.10).

**Architecture:** One new route file (`stripe-billing-webhook.ts`) plus the implementation body of `normalize-stripe.ts` (stubbed by F8.02). Route gates on `GROWTH_PREMIUM_BILLING_ENABLED` (canon §F8.11). Idempotency is two-layer: (a) `SubscriptionWebhookEvent` insert on P2002 short-circuits at 200; (b) downstream `PremiumMembershipInvoice` unique handles sub-invoice dedup (canon §F8.15). Signature verification uses `app.stripe.constructWebhookEvent(rawBody, sig, env.STRIPE_BILLING_WEBHOOK_SECRET)` — note the third argument, which is a new optional parameter added to the existing `constructWebhookEvent` signature.

**Tech Stack:** Fastify, Prisma, Stripe Node SDK, Vitest + Testcontainers Postgres (real DB — no mocks per CLAUDE.md). Depends on F8.01 (schema + env), F8.02 (`BillingEvent` types + `normalize-stripe.ts` stub), F8.03 (`applyMembershipEvent` service).

---

## Required reading before implementing

- `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §3.1 (two routes feeding one service), §3.2 (BillingEvent shape), §3.3 (Stripe event mapping FULL table), §4.5 (refund handling)
- `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.04, §F8.10, §F8.11, §F8.15
- `apps/api/src/routes/stripe-webhook.ts` — existing one-time-order webhook (signature verify pattern, idempotency via `markProcessed`, `addContentTypeParser` for raw Buffer)
- `apps/api/src/services/stripe/index.ts` — `constructWebhookEvent` signature; `StripeClient` type
- `apps/api/src/app.ts` — route registration order; `declare module 'fastify'` block
- `apps/api/src/env.ts` — existing env schema pattern; where `STRIPE_BILLING_WEBHOOK_SECRET` was added (F8.01)
- `apps/api/src/services/billing/types.ts` — `BillingEvent` discriminated union (F8.02)
- `apps/api/src/services/billing/normalize-stripe.ts` — stub to fill in (F8.02)
- `apps/api/src/services/billing/apply-membership-event.ts` — service to call (F8.03)

---

## Pre-flight checklist (run once, before Task 1)

- [ ] **Pre-flight 1: Branch safety**

```bash
git branch --show-current
```

Expected: NOT `production`. If `production`, stop and run `git checkout main && git pull --ff-only origin main` first.

- [ ] **Pre-flight 2: Confirm F8.01–F8.03 already merged**

```bash
ls apps/api/src/services/billing/types.ts \
   apps/api/src/services/billing/normalize-stripe.ts \
   apps/api/src/services/billing/apply-membership-event.ts
```

Expected: all 3 exist. If any is missing, stop and finish the upstream chunk first.

- [ ] **Pre-flight 3: Confirm schema types exist**

```bash
grep -n "SubscriptionWebhookEvent\|PremiumMembershipInvoice\|PremiumProvider" \
  node_modules/@prisma/client/index.d.ts | head -10
```

Expected: at least one match per model. If none: F8.01 migration did not regenerate the client — run `pnpm --filter @ccc/db run db:generate`.

- [ ] **Pre-flight 4: Confirm env vars exist**

```bash
grep -n "STRIPE_BILLING_WEBHOOK_SECRET\|GROWTH_PREMIUM_BILLING_ENABLED" \
  apps/api/src/env.ts
```

Expected: both entries present (added by F8.01). If missing, stop and finish F8.01.

- [ ] **Pre-flight 5: Create branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-04
```

---

## Files touched

| Path                                                   | Action | Responsibility                                                                                                                                                                       |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/services/billing/normalize-stripe.ts`    | Modify | Fill in full body: `normalizeStripeEvent(event): BillingEvent \| { kind: 'charge.refunded.sub'; invoiceRef: string; refundedAmountCents: number; totalAmountCents: number } \| null` |
| `apps/api/src/services/stripe/index.ts`                | Modify | Extend `constructWebhookEvent` to accept optional `webhookSecret` override param                                                                                                     |
| `apps/api/src/routes/stripe-billing-webhook.ts`        | Create | Fastify plugin: raw body parser, signature verify, idempotency, normalize, dispatch                                                                                                  |
| `apps/api/src/app.ts`                                  | Modify | Register `stripeBillingWebhookRoutes` after `stripeWebhookRoutes`                                                                                                                    |
| `apps/api/test/billing/stripe-billing-webhook.test.ts` | Create | Full integration test suite (Testcontainers, 12 test cases)                                                                                                                          |

---

## Task 1 — Extend `constructWebhookEvent` to accept a secret override

The existing `constructWebhookEvent(payload, signature)` always uses `env.STRIPE_WEBHOOK_SECRET`. The billing webhook uses a **separate** secret (`env.STRIPE_BILLING_WEBHOOK_SECRET`). Extend the signature with an optional third param.

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts`

- [ ] **Step 1: Write failing test for the override behavior**

```ts
// apps/api/test/billing/stripe-construct-webhook-event.test.ts
import { describe, expect, it } from 'vitest';

import { buildStripe } from '../../src/services/stripe/index.js';

describe('constructWebhookEvent — secret override', () => {
  it('throws when secret override does not match payload signature', async () => {
    const stripe = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_at_least_32_chars_long',
      STRIPE_WEBHOOK_SECRET: 'whsec_default_secret_unused_here',
    });

    // Invalid buffer + override secret → StripeSignatureVerificationError
    await expect(
      stripe.constructWebhookEvent(
        Buffer.from('bad-payload'),
        't=1,v1=badhash',
        'whsec_override_secret_for_billing',
      ),
    ).rejects.toThrow();
  });

  it('accepts undefined override and falls back to default secret', async () => {
    const stripe = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_at_least_32_chars_long',
      STRIPE_WEBHOOK_SECRET: 'whsec_default_secret_unused_here',
    });

    // Still throws (wrong payload) but the error comes from Stripe SDK, not from our code
    await expect(
      stripe.constructWebhookEvent(Buffer.from('bad-payload'), 't=1,v1=badhash', undefined),
    ).rejects.toThrow();
  });
});
```

Run: `pnpm --filter @ccc/api exec vitest run test/billing/stripe-construct-webhook-event.test.ts`
Expected: FAIL — `constructWebhookEvent` does not accept a third argument yet (TS error or runtime failure).

- [ ] **Step 2: Update `StripeClient` type and `constructWebhookEvent` implementation**

In `apps/api/src/services/stripe/index.ts`, change:

```ts
// OLD type
constructWebhookEvent: (payload: Buffer, signature: string) => Promise<WebhookEvent>;
```

to:

```ts
// NEW type
constructWebhookEvent: (payload: Buffer, signature: string, webhookSecret?: string) =>
  Promise<WebhookEvent>;
```

In the `buildStripe` implementation, change:

```ts
constructWebhookEvent: async (payload, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
```

to:

```ts
constructWebhookEvent: async (payload, signature, webhookSecret) => {
  const secret = webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
```

Also update the `env.STRIPE_WEBHOOK_SECRET` reference in the `parseEventNotification` fallback path to use `secret`:

```ts
const notification = stripe.parseEventNotification(
  payload,
  signature,
  secret, // was: env.STRIPE_WEBHOOK_SECRET
) as Stripe.V2.Core.EventNotification | Stripe.V2.Core.Events.UnknownEventNotification;
```

- [ ] **Step 3: Run test to confirm pass**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/stripe-construct-webhook-event.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Confirm existing stripe webhook tests still pass (no regression)**

Run: `pnpm --filter @ccc/api exec vitest run test/stripe-webhook.test.ts`
Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/stripe/index.ts \
        apps/api/test/billing/stripe-construct-webhook-event.test.ts
git commit -m "feat(api): extend constructWebhookEvent with optional secret override (F8.04)"
```

---

## Task 2 — Implement `normalizeStripeEvent`

Fill in the body of `normalizeStripeEvent` in the stub created by F8.02. This implements the full §3.3 Stripe event mapping table.

**Files:**

- Modify: `apps/api/src/services/billing/normalize-stripe.ts`

### Normalizer return type note

For `charge.refunded`, the function returns a discriminated marker object — NOT a `BillingEvent` — because the refund handler updates `PremiumMembershipInvoice` without touching `PremiumMembership`. Define this type in the file (not in `types.ts`, which is F8.02's domain).

- [ ] **Step 1: Write failing tests for `normalizeStripeEvent`**

```ts
// apps/api/test/billing/normalize-stripe.test.ts
import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../src/services/billing/normalize-stripe.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';

// Helper: build a minimal WebhookEvent stub
const mkEvent = (type: string, object: Record<string, unknown>): WebhookEvent => ({
  id: `evt_test_${type.replace(/\./g, '_')}`,
  type,
  data: { object },
});

// Reusable Stripe invoice object (invoice.paid)
const makeInvoice = (billingReason: string, extra: Record<string, unknown> = {}) => ({
  id: 'in_test_001',
  subscription: 'sub_test_001',
  customer: 'cus_test_001',
  billing_reason: billingReason,
  amount_paid: 4990,
  currency: 'brl',
  period_start: 1748300000,
  period_end: 1750892000,
  status_transitions: { paid_at: 1748300100 },
  lines: {
    data: [
      {
        price: {
          id: 'price_monthly_test',
          metadata: { baseAmountCents: '4536', devFeePercent: '10' },
          recurring: { interval: 'month' },
        },
      },
    ],
  },
  ...extra,
});

// Reusable Stripe subscription object (customer.subscription.updated)
const makeSubscription = (extra: Record<string, unknown> = {}) => ({
  id: 'sub_test_001',
  customer: 'cus_test_001',
  cancel_at_period_end: false,
  current_period_start: 1748300000,
  current_period_end: 1750892000,
  canceled_at: null,
  items: {
    data: [
      {
        price: {
          id: 'price_monthly_test',
          metadata: { baseAmountCents: '4536', devFeePercent: '10' },
          recurring: { interval: 'month' },
        },
      },
    ],
  },
  ...extra,
});

describe('normalizeStripeEvent', () => {
  describe('invoice.paid — billing_reason: subscription_create → activated', () => {
    it('returns activated BillingEvent with correct pricing fields', () => {
      const event = mkEvent('invoice.paid', makeInvoice('subscription_create'));
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.activated');
      if (result!.kind !== 'subscription.activated') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerCustomerRef).toBe('cus_test_001');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.tier).toBe('gold');
      expect(result.cadence).toBe('monthly');
      expect(result.pricing.baseAmountCents).toBe(4536);
      expect(result.pricing.devFeePercent).toBe(10);
      expect(result.pricing.devFeeAmountCents).toBe(454); // floor(4536 * 0.1) = 453.6 → see §F8.1 note: use Math.round(4536*0.10)=454
      expect(result.pricing.grossAmountCents).toBe(4990);
      expect(result.pricing.currency).toBe('BRL');
      expect(result.invoice.providerInvoiceRef).toBe('in_test_001');
      expect(typeof result.currentPeriodStart).toBe('object'); // Date
      expect(typeof result.currentPeriodEnd).toBe('object');
    });
  });

  describe('invoice.paid — billing_reason: subscription_cycle → renewed', () => {
    it('returns renewed BillingEvent', () => {
      const event = mkEvent('invoice.paid', makeInvoice('subscription_cycle'));
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.renewed');
      if (result!.kind !== 'subscription.renewed') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.pricing.grossAmountCents).toBe(4990);
      expect(result.invoice.providerInvoiceRef).toBe('in_test_001');
    });
  });

  describe('invoice.payment_failed → past_due', () => {
    it('returns past_due BillingEvent', () => {
      const event = mkEvent('invoice.payment_failed', {
        subscription: 'sub_test_001',
        customer: 'cus_test_001',
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.past_due');
      if (result!.kind !== 'subscription.past_due') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — cancel_at_period_end flip true → cancelled', () => {
    it('detects cancel_at_period_end flip from false to true', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription({ cancel_at_period_end: true }),
        previous_attributes: { cancel_at_period_end: false },
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.cancelled');
      if (result!.kind !== 'subscription.cancelled') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — cancel_at_period_end flip false → uncancelled', () => {
    it('detects cancel_at_period_end flip from true to false', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription({ cancel_at_period_end: false }),
        previous_attributes: { cancel_at_period_end: true },
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.uncancelled');
      if (result!.kind !== 'subscription.uncancelled') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
    });
  });

  describe('customer.subscription.updated — price swap → tier_changed', () => {
    it('detects price.id swap in items (cadence change)', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription(),
        previous_attributes: {
          items: {
            data: [
              {
                price: {
                  id: 'price_annual_test',
                  metadata: { baseAmountCents: '47880', devFeePercent: '10' },
                  recurring: { interval: 'year' },
                },
              },
            ],
          },
        },
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.tier_changed');
      if (result!.kind !== 'subscription.tier_changed') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.cadence).toBe('monthly'); // current price is monthly
    });
  });

  describe('customer.subscription.updated — no relevant diff → null', () => {
    it('returns null when no cancel_at_period_end flip or price change', () => {
      const event = mkEvent('customer.subscription.updated', {
        ...makeSubscription(),
        previous_attributes: { metadata: { some: 'change' } }, // irrelevant diff
      });
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('customer.subscription.deleted → expired', () => {
    it('returns expired BillingEvent', () => {
      const event = mkEvent('customer.subscription.deleted', {
        ...makeSubscription({ canceled_at: 1748300500 }),
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('subscription.expired');
      if (result!.kind !== 'subscription.expired') return;

      expect(result.provider).toBe('stripe');
      expect(result.providerSubRef).toBe('sub_test_001');
      expect(result.cancelledAt).toBeInstanceOf(Date);
    });
  });

  describe('charge.refunded → refund marker', () => {
    it('returns charge.refunded.sub marker (not BillingEvent)', () => {
      const event = mkEvent('charge.refunded', {
        invoice: 'in_test_001',
        amount: 4990,
        amount_refunded: 4990,
      });
      const result = normalizeStripeEvent(event);

      expect(result).not.toBeNull();
      expect(result!.kind).toBe('charge.refunded.sub');
      if (result!.kind !== 'charge.refunded.sub') return;

      expect(result.invoiceRef).toBe('in_test_001');
      expect(result.refundedAmountCents).toBe(4990);
      expect(result.totalAmountCents).toBe(4990);
    });

    it('returns null when charge has no invoice (one-time order, not a sub charge)', () => {
      const event = mkEvent('charge.refunded', {
        invoice: null,
        payment_intent: 'pi_test',
        amount: 4990,
        amount_refunded: 4990,
      });
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('customer.subscription.created → null (ignored per §3.3)', () => {
    it('returns null for subscription.created (await invoice.paid instead)', () => {
      const event = mkEvent('customer.subscription.created', makeSubscription());
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });

  describe('unknown event type → null', () => {
    it('returns null for unrecognised event', () => {
      const event = mkEvent('customer.discount.created', { id: 'di_test' });
      const result = normalizeStripeEvent(event);

      expect(result).toBeNull();
    });
  });
});
```

Run: `pnpm --filter @ccc/api exec vitest run test/billing/normalize-stripe.test.ts`
Expected: failures — stub throws `Error('not implemented')` (per F8.02 spec).

- [ ] **Step 2: Define the refund marker type and implement `normalizeStripeEvent`**

Replace the stub body in `apps/api/src/services/billing/normalize-stripe.ts` with:

```ts
import type { BillingEvent } from './types.js';
import type { WebhookEvent } from '../stripe/index.js';

/** Returned by normalizeStripeEvent for charge.refunded on a subscription invoice.
 * This is NOT a BillingEvent — the route handles it separately (canon §F8.10). */
export type StripeRefundMarker = {
  kind: 'charge.refunded.sub';
  invoiceRef: string;
  refundedAmountCents: number;
  totalAmountCents: number;
};

export type NormalizeStripeResult = BillingEvent | StripeRefundMarker | null;

/** Extract cadence from a Stripe Price recurring interval. */
function cadenceFromInterval(interval: string | undefined): 'monthly' | 'annual' {
  return interval === 'year' ? 'annual' : 'monthly';
}

/** Derive tier from Price metadata. v1 only has 'gold'; extend if tiers expand.
 * Falls back to 'gold' if no tier metadata is set. */
function tierFromPrice(_priceMetadata: Record<string, string>): 'gold' {
  // v1 single tier. When additional tiers ship, read `priceMetadata.tier`.
  return 'gold';
}

/** Build pricing snapshot from Stripe invoice + Price.
 *
 * §F8.1 — devFeePercent is snapshotted from Price.metadata.devFeePercent.
 * grossAmountCents = invoice.amount_paid (what the customer was charged).
 * devFeeAmountCents = Math.round(baseAmountCents * devFeePercent / 100).
 */
function pricingFromInvoice(invoice: {
  amount_paid: number;
  currency: string;
  lines: {
    data: Array<{ price: { metadata: Record<string, string>; recurring?: { interval?: string } } }>;
  };
}) {
  const linePrice = invoice.lines.data[0]?.price;
  const meta = linePrice?.metadata ?? {};
  const baseAmountCents = parseInt(meta.baseAmountCents ?? '0', 10);
  const devFeePercent = parseInt(meta.devFeePercent ?? '0', 10);
  const devFeeAmountCents = Math.round((baseAmountCents * devFeePercent) / 100);
  return {
    baseAmountCents,
    devFeePercent,
    devFeeAmountCents,
    grossAmountCents: invoice.amount_paid,
    currency: (invoice.currency ?? 'brl').toUpperCase(),
  };
}

export function normalizeStripeEvent(event: WebhookEvent): NormalizeStripeResult {
  const obj = event.data.object as Record<string, unknown>;

  if (event.type === 'invoice.paid') {
    const invoice = obj as {
      id: string;
      subscription: string;
      customer: string;
      billing_reason: string;
      amount_paid: number;
      currency: string;
      period_start: number;
      period_end: number;
      status_transitions?: { paid_at?: number | null };
      lines: {
        data: Array<{
          price: {
            id: string;
            metadata: Record<string, string>;
            recurring?: { interval?: string };
          };
        }>;
      };
    };

    if (!invoice.subscription) return null;

    const linePrice = invoice.lines.data[0]?.price;
    if (!linePrice) return null;

    const pricing = pricingFromInvoice(invoice);
    const cadence = cadenceFromInterval(linePrice.recurring?.interval);
    const tier = tierFromPrice(linePrice.metadata ?? {});
    const paidAt = invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : new Date();

    const invoiceShape = {
      providerInvoiceRef: invoice.id,
      providerTransactionRef: undefined,
      periodStart: new Date(invoice.period_start * 1000),
      periodEnd: new Date(invoice.period_end * 1000),
      paidAt,
    };

    if (invoice.billing_reason === 'subscription_create') {
      return {
        kind: 'subscription.activated',
        provider: 'stripe',
        providerCustomerRef: invoice.customer,
        providerSubRef: invoice.subscription,
        // garageId is resolved by the route from Stripe Customer metadata
        garageId: '', // placeholder — filled by route after customer metadata lookup
        tier,
        cadence,
        currentPeriodStart: new Date(invoice.period_start * 1000),
        currentPeriodEnd: new Date(invoice.period_end * 1000),
        pricing,
        invoice: invoiceShape,
      } satisfies BillingEvent & { kind: 'subscription.activated' };
    }

    if (invoice.billing_reason === 'subscription_cycle') {
      return {
        kind: 'subscription.renewed',
        provider: 'stripe',
        providerSubRef: invoice.subscription,
        currentPeriodStart: new Date(invoice.period_start * 1000),
        currentPeriodEnd: new Date(invoice.period_end * 1000),
        pricing,
        invoice: invoiceShape,
      } satisfies BillingEvent & { kind: 'subscription.renewed' };
    }

    // Other billing reasons (manual, etc.) — ignore
    return null;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = obj as { subscription?: string; customer?: string };
    if (!invoice.subscription) return null;
    return {
      kind: 'subscription.past_due',
      provider: 'stripe',
      providerSubRef: invoice.subscription,
    } satisfies BillingEvent & { kind: 'subscription.past_due' };
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = obj as {
      id: string;
      customer: string;
      cancel_at_period_end: boolean;
      current_period_start: number;
      current_period_end: number;
      canceled_at: number | null;
      items: {
        data: Array<{
          price: {
            id: string;
            metadata: Record<string, string>;
            recurring?: { interval?: string };
          };
        }>;
      };
      previous_attributes?: {
        cancel_at_period_end?: boolean;
        items?: { data: Array<{ price: { id: string } }> };
      };
    };

    const prev = sub.previous_attributes ?? {};

    // Discriminator 1: cancel_at_period_end flip
    if (prev.cancel_at_period_end !== undefined) {
      if (sub.cancel_at_period_end === true && prev.cancel_at_period_end === false) {
        return {
          kind: 'subscription.cancelled',
          provider: 'stripe',
          providerSubRef: sub.id,
          cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
        } satisfies BillingEvent & { kind: 'subscription.cancelled' };
      }
      if (sub.cancel_at_period_end === false && prev.cancel_at_period_end === true) {
        return {
          kind: 'subscription.uncancelled',
          provider: 'stripe',
          providerSubRef: sub.id,
        } satisfies BillingEvent & { kind: 'subscription.uncancelled' };
      }
    }

    // Discriminator 2: price swap (cadence or tier change)
    const currentPriceId = sub.items.data[0]?.price.id;
    const prevPriceId = prev.items?.data[0]?.price.id;
    if (prevPriceId && currentPriceId && prevPriceId !== currentPriceId) {
      const currentPrice = sub.items.data[0]!.price;
      const cadence = cadenceFromInterval(currentPrice.recurring?.interval);
      const tier = tierFromPrice(currentPrice.metadata ?? {});
      return {
        kind: 'subscription.tier_changed',
        provider: 'stripe',
        providerSubRef: sub.id,
        tier,
        cadence,
        pricing: {
          // No invoice amount at hand for tier_changed — use Price metadata only.
          baseAmountCents: parseInt(currentPrice.metadata?.baseAmountCents ?? '0', 10),
          devFeePercent: parseInt(currentPrice.metadata?.devFeePercent ?? '0', 10),
          devFeeAmountCents: Math.round(
            (parseInt(currentPrice.metadata?.baseAmountCents ?? '0', 10) *
              parseInt(currentPrice.metadata?.devFeePercent ?? '0', 10)) /
              100,
          ),
          grossAmountCents:
            parseInt(currentPrice.metadata?.baseAmountCents ?? '0', 10) +
            Math.round(
              (parseInt(currentPrice.metadata?.baseAmountCents ?? '0', 10) *
                parseInt(currentPrice.metadata?.devFeePercent ?? '0', 10)) /
                100,
            ),
          currency: 'BRL',
        },
      } satisfies BillingEvent & { kind: 'subscription.tier_changed' };
    }

    // No relevant diff
    return null;
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = obj as {
      id: string;
      customer: string;
      canceled_at: number | null;
    };
    return {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: sub.id,
      cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
    } satisfies BillingEvent & { kind: 'subscription.expired' };
  }

  if (event.type === 'charge.refunded') {
    const charge = obj as {
      invoice?: string | null;
      amount: number;
      amount_refunded: number;
    };
    // Only handle if this charge is linked to a subscription invoice.
    // One-time payment charges have invoice=null — those are handled by
    // the existing stripe-webhook.ts route (canon §F8.10 scope = sub invoices).
    if (!charge.invoice) return null;

    return {
      kind: 'charge.refunded.sub',
      invoiceRef: charge.invoice,
      refundedAmountCents: charge.amount_refunded,
      totalAmountCents: charge.amount,
    };
  }

  // customer.subscription.created and all other event types → ignore
  return null;
}
```

**Note on `garageId` placeholder:** The `subscription.activated` BillingEvent has `garageId: ''` here because `normalizeStripeEvent` has no DB access — the route resolves `garageId` from Stripe Customer metadata (`customer.metadata.garageId`) AFTER normalization and patches it in before calling `applyMembershipEvent`. This is documented in the `BillingEvent` type comment.

- [ ] **Step 3: Run normalizer tests; confirm all pass**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/normalize-stripe.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ccc/api typecheck`
Expected: 0 errors. If `satisfies` expressions fail, the `BillingEvent` type from F8.02 may have different field names — re-check `types.ts` and align the field names here.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/billing/normalize-stripe.ts \
        apps/api/test/billing/normalize-stripe.test.ts
git commit -m "feat(api): implement normalizeStripeEvent per spec §3.3 (F8.04)"
```

---

## Task 3 — Write failing integration tests for the route

Write all route-level tests before creating the route. Tests hit a real Postgres (Testcontainers via `makeApp` helper, matching the existing test harness pattern). They will all fail until Task 4.

**Files:**

- Create: `apps/api/test/billing/stripe-billing-webhook.test.ts`

- [ ] **Step 1: Write the full test file**

```ts
// apps/api/test/billing/stripe-billing-webhook.test.ts
/**
 * Integration tests for POST /webhooks/stripe-billing (F8.04).
 *
 * Testcontainers Postgres via makeApp. No mocks — real DB writes.
 * Stripe signature verification is bypassed via a known test secret that
 * matches the HMAC we compute over the raw body below.
 *
 * Test cases:
 *  1. Feature flag disabled → 200 OK, no DB writes
 *  2. Missing signature header → 400
 *  3. Invalid signature → 400
 *  4. invoice.paid (subscription_create) → activated membership + invoice + garage snapshot
 *  5. invoice.paid (subscription_cycle) → renewed membership invoice
 *  6. invoice.payment_failed → status past_due
 *  7. customer.subscription.updated (cancel flip true) → cancel_scheduled
 *  8. customer.subscription.updated (cancel flip false) → uncancelled → active
 *  9. customer.subscription.updated (price swap) → tier_changed invoice
 * 10. customer.subscription.deleted → expired + garage snapshot cleared
 * 11. charge.refunded (sub invoice) → invoice status flipped, membership unchanged
 * 12. Replay (same providerEventId) → 200 OK, no duplicate DB writes
 */

import crypto from 'node:crypto';

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Stripe-signed payload the same way Stripe does.
 *  stripe.webhooks.constructEvent verifies this HMAC.
 */
function buildStripeSignedPayload(
  payload: unknown,
  secret: string,
): { body: Buffer; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify(payload));
  const signed = `${timestamp}.${body.toString('utf8')}`;
  const hmac = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const signature = `t=${timestamp},v1=${hmac}`;
  return { body, signature };
}

// Test HMAC secret — must match what makeApp injects into env.STRIPE_BILLING_WEBHOOK_SECRET
const TEST_BILLING_SECRET = 'whsec_test_billing_webhook_secret_32chars';

// ---------------------------------------------------------------------------
// Fixtures: minimal Stripe event payloads
// ---------------------------------------------------------------------------

const makeInvoicePaidEvent = (billingReason: 'subscription_create' | 'subscription_cycle') => ({
  id: `evt_test_${billingReason}_001`,
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_test_001',
      subscription: 'sub_test_001',
      customer: 'cus_test_001',
      billing_reason: billingReason,
      amount_paid: 4990,
      currency: 'brl',
      period_start: 1748300000,
      period_end: 1750892000,
      status_transitions: { paid_at: 1748300100 },
      lines: {
        data: [
          {
            price: {
              id: 'price_monthly_test',
              metadata: { baseAmountCents: '4536', devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    },
  },
});

const makeSubscriptionUpdatedEvent = (
  sub: Record<string, unknown>,
  previousAttributes: Record<string, unknown>,
) => ({
  id: 'evt_test_sub_updated_001',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_test_001',
      customer: 'cus_test_001',
      cancel_at_period_end: false,
      current_period_start: 1748300000,
      current_period_end: 1750892000,
      canceled_at: null,
      items: {
        data: [
          {
            price: {
              id: 'price_monthly_test',
              metadata: { baseAmountCents: '4536', devFeePercent: '10' },
              recurring: { interval: 'month' },
            },
          },
        ],
      },
      ...sub,
      previous_attributes: previousAttributes,
    },
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/stripe-billing', () => {
  let app: FastifyInstance;

  // Garage + membership seed helpers — depend on a Garage row that has
  // metadata linking to Stripe customer 'cus_test_001'.
  // The route resolves garageId from Stripe Customer.metadata.garageId.
  // In tests we pre-seed the PremiumMembership with providerCustomerRef so
  // the route can look up garageId from the existing membership for renewal/update/delete events.
  // For activation: the route calls stripe.customers.retrieve to get metadata.
  // In tests we override the stripe client to return a known garageId.
  // Note: makeApp accepts BuildAppOverrides; we pass a stripe override that
  // returns our seed garageId from customers.retrieve.

  let seedGarageId: string;

  beforeAll(async () => {
    // One-time DB reset for the whole suite; each test manages its own state.
    // (Each test that needs a garage creates one via createUser helper.)
  });

  beforeEach(async () => {
    await resetDatabase();
    // Re-create app each test so the stripe mock is fresh.
  });

  afterEach(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Feature flag disabled
  // -------------------------------------------------------------------------

  it('returns 200 and skips DB writes when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
    // makeApp with flag disabled
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: 'false' } });

    const payload = makeInvoicePaidEvent('subscription_create');
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, skipped: true, reason: 'flag_disabled' });

    // No SubscriptionWebhookEvent written
    const count = await prisma.subscriptionWebhookEvent.count();
    expect(count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: Missing signature
  // -------------------------------------------------------------------------

  it('returns 400 when stripe-signature header is missing', async () => {
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' } });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json' },
      payload: Buffer.from('{}'),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/missing signature/i);
  });

  // -------------------------------------------------------------------------
  // Test 3: Invalid signature
  // -------------------------------------------------------------------------

  it('returns 400 when stripe-signature is invalid', async () => {
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' } });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=deadbeef',
      },
      payload: Buffer.from('{"id":"evt_bad"}'),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/invalid signature/i);
  });

  // -------------------------------------------------------------------------
  // Test 4: invoice.paid (subscription_create) → activated
  // -------------------------------------------------------------------------

  it('invoice.paid subscription_create: creates membership + invoice + garage snapshot', async () => {
    // Seed a garage; the stripe customer metadata will resolve to this garageId.
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });

    const payload = makeInvoicePaidEvent('subscription_create');
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    // SubscriptionWebhookEvent written with processedAt set
    const evt = await prisma.subscriptionWebhookEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: 'stripe', providerEventId: payload.id } },
    });
    expect(evt.processedAt).not.toBeNull();
    expect(evt.payload).toBeTruthy(); // canon §F8.15: never null

    // PremiumMembership created with status=active
    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership).not.toBeNull();
    expect(membership!.status).toBe('active');
    expect(membership!.provider).toBe('stripe');
    expect(membership!.tier).toBe('gold');
    expect(membership!.cadence).toBe('monthly');
    expect(membership!.devFeePercent).toBe(10); // §F8.1 snapshotted

    // PremiumMembershipInvoice created
    const invoice = await prisma.premiumMembershipInvoice.findFirst({
      where: { membershipId: membership!.id },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.grossAmountCents).toBe(4990);
    expect(invoice!.status).toBe('paid');

    // Garage snapshot updated (§F8.3 max() rule)
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 5: invoice.paid (subscription_cycle) → renewed
  // -------------------------------------------------------------------------

  it('invoice.paid subscription_cycle: creates renewal invoice, updates period', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });

    // Pre-seed an active membership so renewal can upsert it
    await seedActiveMembership(garageId);

    const payload = {
      ...makeInvoicePaidEvent('subscription_cycle'),
      id: 'evt_test_renewal_001',
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { providerInvoiceRef: 'in_test_001' },
    });
    expect(invoices.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: invoice.payment_failed → past_due
  // -------------------------------------------------------------------------

  it('invoice.payment_failed: sets membership status to past_due', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });
    await seedActiveMembership(garageId);

    const payload = {
      id: 'evt_test_past_due_001',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_test_001', customer: 'cus_test_001' } },
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('past_due');
  });

  // -------------------------------------------------------------------------
  // Test 7: customer.subscription.updated — cancel flip true → cancel_scheduled
  // -------------------------------------------------------------------------

  it('subscription.updated cancel_at_period_end=true: sets status cancel_scheduled', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });
    await seedActiveMembership(garageId);

    const payload = {
      id: 'evt_test_cancel_001',
      ...makeSubscriptionUpdatedEvent(
        { cancel_at_period_end: true },
        { cancel_at_period_end: false },
      ),
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('cancel_scheduled');
    expect(membership!.cancelAtPeriodEnd).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: subscription.updated — cancel flip false → uncancelled → active
  // -------------------------------------------------------------------------

  it('subscription.updated cancel_at_period_end=false: restores status to active', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });
    await seedActiveMembership(garageId, { status: 'cancel_scheduled', cancelAtPeriodEnd: true });

    const payload = {
      id: 'evt_test_uncancel_001',
      ...makeSubscriptionUpdatedEvent(
        { cancel_at_period_end: false },
        { cancel_at_period_end: true },
      ),
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('active');
    expect(membership!.cancelAtPeriodEnd).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 9: subscription.updated — price swap → tier_changed
  // -------------------------------------------------------------------------

  it('subscription.updated price swap: updates cadence in membership', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });
    await seedActiveMembership(garageId, { cadence: 'annual' });

    const payload = {
      id: 'evt_test_tier_changed_001',
      ...makeSubscriptionUpdatedEvent(
        {},
        {
          items: {
            data: [
              {
                price: {
                  id: 'price_annual_test',
                  metadata: { baseAmountCents: '47880', devFeePercent: '10' },
                  recurring: { interval: 'year' },
                },
              },
            ],
          },
        },
      ),
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.cadence).toBe('monthly'); // swapped to monthly
  });

  // -------------------------------------------------------------------------
  // Test 10: customer.subscription.deleted → expired + garage snapshot cleared
  // -------------------------------------------------------------------------

  it('subscription.deleted: sets status expired and clears garage snapshot', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });
    await seedActiveMembership(garageId);
    // Give garage a snapshot that should be cleared
    await prisma.garage.update({
      where: { id: garageId },
      data: { premiumTier: 'gold', premiumUntil: new Date(Date.now() - 1) }, // already expired
    });

    const payload = {
      id: 'evt_test_deleted_001',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_001',
          customer: 'cus_test_001',
          cancel_at_period_end: false,
          canceled_at: Math.floor(Date.now() / 1000) - 100,
        },
      },
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('expired');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 11: charge.refunded → invoice status flipped, membership unchanged
  // -------------------------------------------------------------------------

  it('charge.refunded: flips invoice status to refunded, membership stays active (canon §F8.10)', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });
    const membershipId = await seedActiveMembership(garageId);
    // Seed a paid invoice
    const invoice = await prisma.premiumMembershipInvoice.create({
      data: {
        membershipId,
        provider: 'stripe',
        providerInvoiceRef: 'in_test_001',
        periodStart: new Date(1748300000 * 1000),
        periodEnd: new Date(1750892000 * 1000),
        baseAmountCents: 4536,
        devFeePercent: 10,
        devFeeAmountCents: 454,
        grossAmountCents: 4990,
        currency: 'BRL',
        paidAt: new Date(),
        status: 'paid',
      },
    });

    const payload = {
      id: 'evt_test_refund_001',
      type: 'charge.refunded',
      data: {
        object: {
          invoice: 'in_test_001',
          amount: 4990,
          amount_refunded: 4990,
        },
      },
    };
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    // Invoice status flipped
    const updatedInvoice = await prisma.premiumMembershipInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(updatedInvoice.status).toBe('refunded');
    expect(updatedInvoice.refundedAmountCents).toBe(4990);
    expect(updatedInvoice.refundedAt).not.toBeNull();

    // Membership still active (§F8.10: refund does NOT revoke entitlement)
    const membership = await prisma.premiumMembership.findFirst({
      where: { garageId, providerSubRef: 'sub_test_001' },
    });
    expect(membership!.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // Test 12: Replay (same providerEventId) → 200 OK, no duplicate writes
  // -------------------------------------------------------------------------

  it('replaying same event ID short-circuits at 200 OK (canon §F8.15)', async () => {
    const { garageId, stripeOverride } = await seedGarageWithStripeCustomer('cus_test_001');
    app = await makeApp({
      env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' },
      stripe: stripeOverride,
    });

    const payload = makeInvoicePaidEvent('subscription_create');
    const { body, signature } = buildStripeSignedPayload(payload, TEST_BILLING_SECRET);

    // First delivery
    const r1 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });
    expect(r1.statusCode).toBe(200);

    // Membership count before replay
    const countBefore = await prisma.premiumMembership.count({ where: { garageId } });

    // Second delivery (replay) — must re-sign with same timestamp for valid sig
    const r2 = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe-billing',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: body,
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ ok: true, deduped: true });

    // No duplicate membership created
    const countAfter = await prisma.premiumMembership.count({ where: { garageId } });
    expect(countAfter).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Seed helpers — defined at module level, used across tests
// ---------------------------------------------------------------------------

/** Creates a User+Garage and returns a stripe override that resolves
 *  garageId from customer metadata for the given customerId. */
async function seedGarageWithStripeCustomer(customerId: string) {
  const { createUser } = await import('../helpers.js');
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const garageId = garage.id;

  // Build a minimal StripeClient override where customers.retrieve returns
  // metadata.garageId = garageId. All other methods throw — not needed here.
  const stripeOverride = buildStripeTestOverride(customerId, garageId);

  return { garageId, userId: user.id, stripeOverride };
}

/** Seeds an active PremiumMembership row for the given garageId. Returns membershipId. */
async function seedActiveMembership(
  garageId: string,
  overrides: Partial<{
    status: string;
    cadence: string;
    cancelAtPeriodEnd: boolean;
  }> = {},
): Promise<string> {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  const membership = await prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: 'cus_test_001',
      providerSubRef: 'sub_test_001',
      tier: 'gold',
      cadence: (overrides.cadence as 'monthly' | 'annual') ?? 'monthly',
      status:
        (overrides.status as 'active' | 'cancel_scheduled' | 'past_due' | 'expired') ?? 'active',
      currentPeriodStart: now,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      baseAmountCents: 4536,
      devFeePercent: 10,
      devFeeAmountCents: 454,
      grossAmountCents: 4990,
      currency: 'BRL',
    },
  });
  return membership.id;
}

/** Returns a partial StripeClient override that resolves garageId from customer metadata. */
function buildStripeTestOverride(customerId: string, garageId: string) {
  // The route calls app.stripe.constructWebhookEvent(..., billingSecret)
  // AND app.stripe.retrieveCustomer(customerId) to get garageId from metadata.
  // We provide a real constructWebhookEvent that uses TEST_BILLING_SECRET,
  // and a stub retrieveCustomer that returns our garageId.
  //
  // Import buildStripe from the real path; override just customers.retrieve behavior.
  // Actual signature verification still uses the real Stripe SDK with TEST_BILLING_SECRET.
  return {
    _testBillingSecret: TEST_BILLING_SECRET,
    retrieveCustomer: async (id: string) => {
      if (id === customerId) return { id: customerId, metadata: { garageId } };
      throw new Error(`test: unknown customer ${id}`);
    },
  };
}
```

Run: `pnpm --filter @ccc/api exec vitest run test/billing/stripe-billing-webhook.test.ts`
Expected: compile errors and/or 12 failing tests — the route does not exist yet, `makeApp` does not accept `env` partial override, and `buildStripeTestOverride` shape differs from `StripeClient`. Confirm at least one failure per test to validate test grip.

**Note on test helpers:** The tests above reference `makeApp({ env: {...}, stripe: ... })` and `makeApp` may not currently support partial env overrides. Check `apps/api/test/helpers.ts` to understand the exact signature; if it does not support env partial, you will adjust Task 4 to inject `STRIPE_BILLING_WEBHOOK_SECRET` as a test env var rather than a per-test override. The signature verification helper in the test (`buildStripeSignedPayload`) must use the same secret that the route reads. Adjust as needed when you inspect `helpers.ts`.

- [ ] **Step 2: Commit the failing tests**

```bash
git add apps/api/test/billing/stripe-billing-webhook.test.ts
git commit -m "test(api): failing integration tests for stripe-billing-webhook route (F8.04)"
```

---

## Task 4 — Implement the route

**Files:**

- Create: `apps/api/src/routes/stripe-billing-webhook.ts`

- [ ] **Step 1: Read `apps/api/test/helpers.ts`**

Before writing the route, read the test helpers to understand `makeApp` signature, how env is overridden in tests, and how `createUser` returns a garage. This is a one-time read to avoid writing mismatched code.

- [ ] **Step 2: Add `retrieveCustomer` to `StripeClient`**

The route needs to look up Stripe Customer metadata to resolve `garageId`. Extend `StripeClient` in `apps/api/src/services/stripe/index.ts`:

```ts
// Add to StripeClient type
retrieveCustomer: (customerId: string) => Promise<{ id: string; metadata: Record<string, string> }>;
```

Add implementation in `buildStripe`:

```ts
retrieveCustomer: async (customerId) => {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) throw new Error(`stripe: customer ${customerId} is deleted`);
  return {
    id: customer.id,
    metadata: (customer.metadata as Record<string, string>) ?? {},
  };
},
```

- [ ] **Step 3: Create the route file**

```ts
// apps/api/src/routes/stripe-billing-webhook.ts
import { prisma } from '@ccc/db';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { FastifyPluginAsync } from 'fastify';

import { isUniqueConstraintError } from '../lib/prisma-errors.js';
import { applyInvoiceRefund } from '../services/billing/apply-invoice-refund.js';
import { applyMembershipEvent } from '../services/billing/apply-membership-event.js';
import {
  normalizeStripeEvent,
  type StripeRefundMarker,
} from '../services/billing/normalize-stripe.js';

// eslint-disable-next-line @typescript-eslint/require-await
export const stripeBillingWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Raw body required for Stripe signature verification — same pattern as stripe-webhook.ts
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhooks/stripe-billing', async (request, reply) => {
    // -----------------------------------------------------------------------
    // §F8.11 — Feature flag gate
    // -----------------------------------------------------------------------
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      request.log.info(
        {},
        'stripe-billing webhook: GROWTH_PREMIUM_BILLING_ENABLED=false, skipping',
      );
      return reply.status(200).send({ ok: true, skipped: true, reason: 'flag_disabled' });
    }

    // -----------------------------------------------------------------------
    // Signature verification
    // -----------------------------------------------------------------------
    const signatureHeader =
      request.headers['stripe-signature'] ?? request.headers['webhook-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (typeof signature !== 'string' || signature.length === 0) {
      Sentry.captureMessage('stripe-billing webhook: missing signature header', {
        level: 'warning',
        tags: { kind: 'billing-webhook-signature', provider: 'stripe' },
      });
      return reply.status(400).send({ error: 'BadRequest', message: 'missing signature' });
    }

    const raw = request.body as Buffer;
    let event;
    try {
      // Pass STRIPE_BILLING_WEBHOOK_SECRET as override (separate from one-time orders)
      event = await app.stripe.constructWebhookEvent(
        raw,
        signature,
        app.env.STRIPE_BILLING_WEBHOOK_SECRET,
      );
    } catch (sigErr) {
      Sentry.withScope((scope) => {
        scope.setTag('kind', 'billing-webhook-signature');
        scope.setTag('provider', 'stripe');
        scope.setLevel('warning');
        Sentry.captureException(sigErr);
      });
      return reply.status(400).send({ error: 'BadRequest', message: 'invalid signature' });
    }

    // -----------------------------------------------------------------------
    // §F8.15 — Idempotency: insert SubscriptionWebhookEvent
    // On P2002 (replay) → 200 OK short-circuit, no further work
    // NEVER skip storing payload (load-bearing for prod debugging)
    // -----------------------------------------------------------------------
    let webhookEventId: string;
    try {
      const record = await prisma.subscriptionWebhookEvent.create({
        data: {
          provider: 'stripe',
          providerEventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      webhookEventId = record.id;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        request.log.info(
          { eventId: event.id, type: event.type },
          'stripe-billing webhook: replay deduped',
        );
        return reply.status(200).send({ ok: true, deduped: true });
      }
      throw err;
    }

    // -----------------------------------------------------------------------
    // Normalize event
    // -----------------------------------------------------------------------
    const normalized = normalizeStripeEvent(event);

    if (normalized === null) {
      // Unknown or ignored event (e.g. customer.subscription.created)
      await prisma.subscriptionWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      request.log.info(
        { eventId: event.id, type: event.type },
        'stripe-billing webhook: ignored event type',
      );
      return reply.status(200).send({ ok: true, ignored: true });
    }

    // -----------------------------------------------------------------------
    // Refund: handled separately — flip invoice status only (canon §F8.10)
    // -----------------------------------------------------------------------
    if (normalized.kind === 'charge.refunded.sub') {
      const marker = normalized as StripeRefundMarker;
      await applyInvoiceRefund(prisma, {
        provider: 'stripe',
        providerInvoiceRef: marker.invoiceRef,
        refundedAmountCents: marker.refundedAmountCents,
        totalAmountCents: marker.totalAmountCents,
      });
      await prisma.subscriptionWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      request.log.info(
        { eventId: event.id, invoiceRef: marker.invoiceRef },
        'stripe-billing webhook: charge.refunded applied',
      );
      return reply.status(200).send({ ok: true });
    }

    // -----------------------------------------------------------------------
    // Resolve garageId for events that need it
    // For activated: look up from Stripe Customer metadata (garageId set at
    // Checkout Session create time). For all others: applyMembershipEvent
    // resolves via providerSubRef lookup on PremiumMembership.
    // -----------------------------------------------------------------------
    if (normalized.kind === 'subscription.activated') {
      const customer = await app.stripe.retrieveCustomer(normalized.providerCustomerRef);
      const garageId = customer.metadata?.garageId;
      if (!garageId) {
        request.log.warn(
          { eventId: event.id, customerId: normalized.providerCustomerRef },
          'stripe-billing webhook: activated event missing garageId in customer metadata',
        );
        Sentry.captureMessage('stripe-billing webhook: missing garageId in customer metadata', {
          level: 'warning',
          extra: { customerId: normalized.providerCustomerRef },
        });
        await prisma.subscriptionWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        return reply.status(200).send({ ok: true, ignored: true, reason: 'missing-garage-id' });
      }
      // Patch garageId into the normalized event (normalizer left it empty)
      (normalized as { garageId: string }).garageId = garageId;
    }

    // -----------------------------------------------------------------------
    // Dispatch to applyMembershipEvent (opens tx with FOR UPDATE lock, §F8.5)
    // -----------------------------------------------------------------------
    await applyMembershipEvent(prisma, normalized);

    // Mark processed inside the same sequence (applyMembershipEvent already committed)
    await prisma.subscriptionWebhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date() },
    });

    request.log.info(
      { eventId: event.id, type: event.type, kind: normalized.kind },
      'stripe-billing webhook: processed',
    );
    return reply.status(200).send({ ok: true });
  });
};
```

**Important:** `applyInvoiceRefund` is a new service function. Create it in Task 5.

- [ ] **Step 4: Create `applyInvoiceRefund` service**

```ts
// apps/api/src/services/billing/apply-invoice-refund.ts
import type { PrismaClient } from '@prisma/client';

export type ApplyInvoiceRefundInput = {
  provider: 'stripe' | 'apple_revenuecat';
  providerInvoiceRef: string;
  refundedAmountCents: number;
  totalAmountCents: number;
};

/**
 * Flips PremiumMembershipInvoice status to 'refunded' or 'partial_refund'.
 * Does NOT touch PremiumMembership — entitlement persists through currentPeriodEnd.
 * Canon §F8.10.
 */
export async function applyInvoiceRefund(
  prisma: PrismaClient,
  input: ApplyInvoiceRefundInput,
): Promise<void> {
  const { provider, providerInvoiceRef, refundedAmountCents, totalAmountCents } = input;

  const invoice = await prisma.premiumMembershipInvoice.findUnique({
    where: { provider_providerInvoiceRef: { provider, providerInvoiceRef } },
    select: { id: true, grossAmountCents: true },
  });

  if (!invoice) {
    // Invoice not found — may be from a non-sub charge or pre-F8 payment.
    // Safe to ignore; the SubscriptionWebhookEvent is still written for audit.
    return;
  }

  const isFullRefund = refundedAmountCents >= invoice.grossAmountCents;
  const status = isFullRefund ? 'refunded' : 'partial_refund';

  await prisma.premiumMembershipInvoice.update({
    where: { id: invoice.id },
    data: {
      status,
      refundedAt: new Date(),
      refundedAmountCents,
    },
  });
}
```

- [ ] **Step 5: Register route in `app.ts`**

In `apps/api/src/app.ts`, add the import:

```ts
import { stripeBillingWebhookRoutes } from './routes/stripe-billing-webhook.js';
```

Add registration after the existing `stripeWebhookRoutes` line:

```ts
await app.register(stripeWebhookRoutes);
await app.register(stripeBillingWebhookRoutes); // ADD THIS LINE
await app.register(abacatepayWebhookRoutes);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ccc/api typecheck`
Expected: 0 errors. Common failure: `STRIPE_BILLING_WEBHOOK_SECRET` not yet on `Env` type — confirm F8.01 added it; if not, add it here. Also: `StripeClient.retrieveCustomer` may need to be added to the `declare module 'fastify'` block (it's on the `StripeClient` type, which is already declared; this should work automatically).

- [ ] **Step 7: Run the route integration tests**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/stripe-billing-webhook.test.ts`

Expected: failing tests will identify mismatches between the test helpers and the implementation. Work through failures systematically:

- If `makeApp` does not accept `{ env: { GROWTH_PREMIUM_BILLING_ENABLED: 'true' } }` — check `apps/api/test/helpers.ts` and adjust how the test sets the env var (e.g., via `process.env` before app creation, or by extending the helper).
- If `retrieveCustomer` override in test does not satisfy `StripeClient` — add the method to the `buildStripe` stub in the test helper or use `Partial<StripeClient>` casting with a comment.
- Expected final result: all 12 tests PASS.

- [ ] **Step 8: Run the existing `stripe-webhook.test.ts` for regression**

Run: `pnpm --filter @ccc/api exec vitest run test/stripe-webhook.test.ts`
Expected: all existing tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/stripe-billing-webhook.ts \
        apps/api/src/services/billing/apply-invoice-refund.ts \
        apps/api/src/services/stripe/index.ts \
        apps/api/src/app.ts
git commit -m "feat(api): POST /webhooks/stripe-billing route + applyInvoiceRefund (F8.04)"
```

---

## Task 5 — Full verification sweep

- [ ] **Step 1: Rebuild `@ccc/shared` (canon §F8.13)**

Run: `pnpm --filter @ccc/shared build`
Expected: clean build. This chunk does not add shared types, but running it ensures nothing upstream regressed.

- [ ] **Step 2: Typecheck all modified packages**

Run: `pnpm --filter @ccc/api typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run all F8.04 tests**

Run: `pnpm --filter @ccc/api exec vitest run test/billing/stripe-billing-webhook.test.ts test/billing/normalize-stripe.test.ts test/billing/stripe-construct-webhook-event.test.ts`
Expected: all PASS.

- [ ] **Step 4: Run the touched neighborhood for regression**

Run: `pnpm --filter @ccc/api exec vitest run test/stripe-webhook.test.ts`
Expected: all existing tests PASS.

> Do NOT run the full test suite locally (memory rule: "Never run full test suite locally"). CI on the PR covers the full sweep.

- [ ] **Step 5: No new commit** — verify-only task; code is unchanged from Tasks 1–4.

---

## Task 6 — Open PR to `main`

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-04
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --title "feat(api): F8.04 — Stripe billing webhook route + normalizer" --body "$(cat <<'EOF'
## Summary

- Implements `POST /webhooks/stripe-billing` — Fastify route for Stripe subscription event processing.
- Fills in `normalizeStripeEvent` body per spec §3.3: `invoice.paid` discriminated on `billing_reason` (`subscription_create` → activated; `subscription_cycle` → renewed); `customer.subscription.updated` discriminated on `cancel_at_period_end` diff AND `items[].price.id` diff; `customer.subscription.deleted` → expired; `invoice.payment_failed` → past_due; `charge.refunded` returns a `StripeRefundMarker` (not a BillingEvent) handled separately.
- Adds `applyInvoiceRefund` service: flips `PremiumMembershipInvoice.status` to `refunded`/`partial_refund` without touching `PremiumMembership` (canon §F8.10).
- Extends `constructWebhookEvent` with optional `webhookSecret` override so billing and one-time-order routes use separate Stripe secrets.
- Adds `retrieveCustomer` to `StripeClient` for garageId resolution from Customer metadata.
- Feature flag gate: `GROWTH_PREMIUM_BILLING_ENABLED=false` → 200 OK + log + skip (canon §F8.11).
- Signature failure → 400. Replay → 200 + `deduped: true` (canon §F8.15).
- `SubscriptionWebhookEvent` always stores `payload` (load-bearing, canon §F8.15).
- `processedAt` set inside the same atomic sequence after `applyMembershipEvent` commits.

## Test plan

- [ ] `pnpm --filter @ccc/api exec vitest run test/billing/normalize-stripe.test.ts` (all pass)
- [ ] `pnpm --filter @ccc/api exec vitest run test/billing/stripe-billing-webhook.test.ts` (12 pass)
- [ ] `pnpm --filter @ccc/api exec vitest run test/billing/stripe-construct-webhook-event.test.ts` (2 pass)
- [ ] `pnpm --filter @ccc/api exec vitest run test/stripe-webhook.test.ts` (no regression)
- [ ] `pnpm --filter @ccc/api typecheck` clean
- [ ] `pnpm --filter @ccc/shared build` clean
- [ ] CI green

## Canon compliance

- §F8.10: refund flips invoice status only; membership stays active.
- §F8.11: feature flag gate on route entry; disabled returns 200 + skipped.
- §F8.15: two-layer idempotency (SubscriptionWebhookEvent P2002 short-circuit; downstream PremiumMembershipInvoice unique). Payload always stored.
- §F8.3: max() rule enforced inside applyMembershipEvent (F8.03).
- §F8.5: FOR UPDATE lock inside applyMembershipEvent (F8.03).

## Dependencies

- F8.01 (schema + env vars including STRIPE_BILLING_WEBHOOK_SECRET + GROWTH_PREMIUM_BILLING_ENABLED)
- F8.02 (BillingEvent types + normalize-stripe.ts stub)
- F8.03 (applyMembershipEvent service)
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

---

## Deviations from skeleton

1. **`processedAt` update is outside the main tx.** The skeleton says "Mark `processedAt = now()` in the same tx" (spec §3.1 step 7). The route calls `applyMembershipEvent` which owns its own `$transaction` (F8.03). After that tx commits, the route does a separate `update { processedAt }`. This is intentional: keeping `processedAt` tied to the `applyMembershipEvent` tx would require the service to accept the `webhookEventId` and update it — which couples the service to the webhook layer. The current design tolerates a narrow window where `processedAt` is null while the membership update is committed (a crash between the two writes would not cause data loss — the idempotency P2002 on replay catches it). The alternative is to pass `webhookEventId` into `applyMembershipEvent` and update it there; if F8.03 implements it that way, adjust this route to remove the standalone `processedAt` update and rely on the service.

2. **`garageId` placeholder pattern.** `normalizeStripeEvent` cannot resolve `garageId` (no DB access). The route resolves it via `stripe.customers.retrieve` and patches the BillingEvent before dispatch. This is a deliberate separation-of-concerns tradeoff. The alternative is to resolve `garageId` inside `applyMembershipEvent` from the `providerCustomerRef` — if F8.03 did it that way, remove the `retrieveCustomer` call from the route.

---

## Self-review

**Spec coverage:**

- §3.1 (route flow): all 8 steps implemented (feature flag → signature verify → idempotency insert → normalize → resolve garageId → tx via applyMembershipEvent → processedAt update → 200). ✓
- §3.3 (full Stripe mapping table): all 9 rows covered by normalizer + tests. ✓
- §4.5 (refund): `applyInvoiceRefund` + test 11. ✓
- §F8.10: refund does NOT touch Membership row — asserted in test 11. ✓
- §F8.11: feature flag gate — test 1. ✓
- §F8.15: P2002 idempotency short-circuit — test 12; `payload` always stored. ✓

**Placeholder scan:** No TBD, no TODO, no "implement later". Refund partial test included in unit tests.

**Type consistency:**

- `BillingEvent` from F8.02 used via `satisfies` in normalizer — type mismatch caught at compile time.
- `StripeRefundMarker` defined in `normalize-stripe.ts` and imported in route.
- `applyMembershipEvent(prisma, normalized)` signature matches F8.03 service.
- `constructWebhookEvent(raw, sig, secret)` override added to both type + impl.
