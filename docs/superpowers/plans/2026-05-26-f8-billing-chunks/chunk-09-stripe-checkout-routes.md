# F8.09 — Stripe Checkout Routes + Portal + Duplicate-Subscribe Precheck

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three `GET/POST /api/me/premium/*` endpoints — checkout-precheck (spec §5 duplicate-subscribe guard), Stripe Checkout session creation, and Stripe Billing Portal redirect — plus the three Stripe service helpers that back them, shared zod schemas in `@jdm/shared/premium`, and integration tests against real Postgres (Testcontainers).

**Architecture:** New Fastify plugin `apps/api/src/routes/me-premium.ts` registered in `app.ts`. The plugin gate-checks `env.GROWTH_PREMIUM_BILLING_ENABLED` (canon §F8.11) on every request, returning `503` when disabled. The precheck queries `PremiumMembership` for a live row (`status IN ('active','past_due','cancel_scheduled')`). If found it returns `409 AlreadySubscribed` with the correct `manageUrl` branch (Stripe portal URL for `stripe` rows, App Store deep link for `apple_revenuecat` rows). The checkout POST resolves `priceId` from two new env vars (`STRIPE_PRICE_PREMIUM_GOLD_MONTHLY`, `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL`), calls `findOrCreateCustomer` then `createSubscriptionCheckoutSession` from an extended `services/stripe/index.ts`, and returns `{ url, sessionId }`. The billing-portal POST calls `createBillingPortalSession` and returns `{ url }`.

**Tech Stack:** Fastify 4, Prisma 5, Stripe Node SDK (existing `buildStripe` client extended), zod 3, `@jdm/shared/premium` new subpath, vitest + Testcontainers Postgres.

---

## Branch safety preflight (CLAUDE.md)

```bash
git branch --show-current
# If `production` → STOP. Switch to main first.
git checkout main && git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-09
```

## Dependencies on prior chunks

Assumes on `main` before execution:

- **F8.01** — `PremiumMembership` model + `PremiumMembershipStatus` enum + `GROWTH_PREMIUM_BILLING_ENABLED` in `env.ts`. If the migration has NOT landed, STOP.
- **F8.04** (recommended, not blocking) — Stripe billing webhook route that writes `PremiumMembership` rows so the precheck has live data to test against. Integration tests in this chunk seed `PremiumMembership` directly, so F8.04 is not a hard dependency.

If F8.01 is missing, STOP and run that chunk first.

## Corrections + canon refs

- **§F8.11 — Feature flag.** All three endpoints gate on `env.GROWTH_PREMIUM_BILLING_ENABLED`. Disabled → `503 { error: 'ServiceUnavailable', message: 'premium billing not available' }`. Do NOT return `404` (that would confuse clients that probe feature availability).
- **§F8.12 — Filtered test command.** `pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts` — note `exec vitest run`, never `pnpm --filter @jdm/api test -- ...`.
- **§F8.13 — Rebuild @jdm/shared.** After writing `packages/shared/src/premium.ts` + the subpath export, run `pnpm --filter @jdm/shared build` before running API tests.
- **Spec §5** — precheck returns `409 { error: 'AlreadySubscribed', provider, manageUrl }`. The `manageUrl` is:
  - Stripe: a live Stripe Billing Portal URL generated via `createBillingPortalSession` using the membership's `providerCustomerRef`.
  - Apple/RC: the static deep link `https://apps.apple.com/account/subscriptions`.
- **Spec §8.2** — Checkout body accepts `{ cadence: 'monthly' | 'annual' }`. `priceId` is resolved server-side from env; client never sends a raw Stripe price ID.
- **Stripe idempotency key for checkout session** — use `checkout_sub_${garageId}_${cadence}` (stable per user+cadence; prevents duplicate sessions if the user double-taps). This matches the existing `checkout_${order.id}` pattern in `orders.ts:555`.

---

## File Structure

```
packages/shared/src/premium.ts                              (new — zod schemas)
packages/shared/package.json                                (modify — add ./premium subpath)
apps/api/src/services/stripe/index.ts                       (modify — add 3 subscription helpers)
apps/api/src/routes/me-premium.ts                           (new — Fastify plugin with 3 endpoints)
apps/api/src/app.ts                                         (modify — register mePremiumRoutes)
apps/api/src/env.ts                                         (modify — add 2 new price env vars)
apps/api/test/billing/me-premium.test.ts                    (new — integration tests, Testcontainers)
```

**Responsibility boundaries:**

- `packages/shared/src/premium.ts` — zod schemas only. No logic, no Prisma, no Stripe.
- `apps/api/src/services/stripe/index.ts` — Stripe SDK calls only. Returns plain objects; no Prisma, no env reads.
- `apps/api/src/routes/me-premium.ts` — Fastify handler only. Reads `app.env`, calls the stripe service helpers and Prisma, returns HTTP responses.
- `apps/api/test/billing/me-premium.test.ts` — Testcontainers Postgres, Stripe SDK mocked via `vi.mock` (Stripe itself is not a real API call target in unit/integration tests).

---

## Task 1 — Shared zod schemas (`packages/shared/src/premium.ts`)

**Files:**

- Create: `packages/shared/src/premium.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1.1 — Write the failing test for the schemas**

Create `packages/shared/src/__tests__/premium.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  premiumCheckoutRequestSchema,
  premiumCheckoutResponseSchema,
  premiumCheckoutPrecheckResponseSchema,
  premiumBillingPortalResponseSchema,
} from '../premium.js';

describe('premiumCheckoutRequestSchema', () => {
  it('accepts monthly cadence', () => {
    expect(premiumCheckoutRequestSchema.parse({ cadence: 'monthly' })).toEqual({
      cadence: 'monthly',
    });
  });
  it('accepts annual cadence', () => {
    expect(premiumCheckoutRequestSchema.parse({ cadence: 'annual' })).toEqual({
      cadence: 'annual',
    });
  });
  it('rejects unknown cadence', () => {
    expect(() => premiumCheckoutRequestSchema.parse({ cadence: 'weekly' })).toThrow();
  });
  it('rejects missing cadence', () => {
    expect(() => premiumCheckoutRequestSchema.parse({})).toThrow();
  });
});

describe('premiumCheckoutResponseSchema', () => {
  it('accepts valid url + sessionId', () => {
    const result = premiumCheckoutResponseSchema.parse({
      url: 'https://checkout.stripe.com/pay/cs_test_abc',
      sessionId: 'cs_test_abc',
    });
    expect(result.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
    expect(result.sessionId).toBe('cs_test_abc');
  });
});

describe('premiumCheckoutPrecheckResponseSchema', () => {
  it('accepts available=true with no other fields', () => {
    const result = premiumCheckoutPrecheckResponseSchema.parse({ available: true });
    expect(result.available).toBe(true);
  });
  it('accepts AlreadySubscribed shape', () => {
    const result = premiumCheckoutPrecheckResponseSchema.parse({
      available: false,
      error: 'AlreadySubscribed',
      provider: 'stripe',
      manageUrl: 'https://billing.stripe.com/session/test',
    });
    expect(result.available).toBe(false);
    expect(result.error).toBe('AlreadySubscribed');
  });
  it('rejects missing available field', () => {
    expect(() => premiumCheckoutPrecheckResponseSchema.parse({})).toThrow();
  });
});

describe('premiumBillingPortalResponseSchema', () => {
  it('accepts url', () => {
    const result = premiumBillingPortalResponseSchema.parse({
      url: 'https://billing.stripe.com/session/test',
    });
    expect(result.url).toBe('https://billing.stripe.com/session/test');
  });
});
```

- [ ] **Step 1.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/shared exec vitest run src/__tests__/premium.test.ts
```

Expected FAIL: "Cannot find module '../premium.js'".

- [ ] **Step 1.3 — Implement `packages/shared/src/premium.ts`**

```ts
import { z } from 'zod';

/**
 * POST /api/me/premium/checkout — request body.
 * Client sends cadence; server resolves priceId from env (never trusts client price IDs).
 */
export const premiumCheckoutRequestSchema = z.object({
  cadence: z.enum(['monthly', 'annual']),
});

export type PremiumCheckoutRequest = z.infer<typeof premiumCheckoutRequestSchema>;

/**
 * POST /api/me/premium/checkout — success response.
 */
export const premiumCheckoutResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string(),
});

export type PremiumCheckoutResponse = z.infer<typeof premiumCheckoutResponseSchema>;

/**
 * GET /api/me/premium/checkout-precheck — response.
 * Two discriminants: available=true (no live membership) or available=false (AlreadySubscribed).
 */
export const premiumCheckoutPrecheckResponseSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({
    available: z.literal(false),
    error: z.literal('AlreadySubscribed'),
    provider: z.enum(['stripe', 'apple_revenuecat']),
    manageUrl: z.string().url(),
  }),
]);

export type PremiumCheckoutPrecheckResponse = z.infer<typeof premiumCheckoutPrecheckResponseSchema>;

/**
 * POST /api/me/premium/billing-portal — response.
 */
export const premiumBillingPortalResponseSchema = z.object({
  url: z.string().url(),
});

export type PremiumBillingPortalResponse = z.infer<typeof premiumBillingPortalResponseSchema>;
```

- [ ] **Step 1.4 — Run test, confirm PASS**

```bash
pnpm --filter @jdm/shared exec vitest run src/__tests__/premium.test.ts
```

Expected: 9 cases PASS.

- [ ] **Step 1.5 — Add `./premium` subpath in `packages/shared/package.json`**

Insert alphabetically after `"./profile"` and before `"./push"`:

```json
    "./premium": {
      "types": "./src/premium.ts",
      "default": "./dist/premium.js"
    },
```

- [ ] **Step 1.6 — Rebuild `@jdm/shared` (canon §F8.13)**

```bash
pnpm --filter @jdm/shared build
```

Expected: success. `dist/premium.js` and `dist/premium.d.ts` exist.

- [ ] **Step 1.7 — Commit Task 1**

```bash
git add packages/shared/src/premium.ts packages/shared/src/__tests__/premium.test.ts packages/shared/package.json
git commit -m "$(cat <<'EOF'
feat(shared): premiumCheckoutRequestSchema + precheck + portal response schemas (F8.09)

New ./premium subpath in @jdm/shared with four zod schemas:
premiumCheckoutRequestSchema (cadence enum), premiumCheckoutResponseSchema
(url + sessionId), premiumCheckoutPrecheckResponseSchema (discriminated
union on available), premiumBillingPortalResponseSchema (url).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Env vars for Stripe price IDs (`apps/api/src/env.ts`)

**Files:**

- Modify: `apps/api/src/env.ts`

The two price env vars are required in production but optional during tests (tests mock Stripe directly and never call through to real Stripe APIs).

- [ ] **Step 2.1 — Write the failing env test**

Extend `apps/api/test/env.test.ts` with a new `it` block (or add to the existing `describe` if present):

```ts
it('parses STRIPE_PRICE_PREMIUM_GOLD_MONTHLY and STRIPE_PRICE_PREMIUM_GOLD_ANNUAL as optional strings', () => {
  const parsed = envSchema.safeParse({
    ...minimalValidEnv,
    STRIPE_PRICE_PREMIUM_GOLD_MONTHLY: 'price_1AbcTest',
    STRIPE_PRICE_PREMIUM_GOLD_ANNUAL: 'price_1XyzTest',
  });
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('parse failed');
  expect(parsed.data.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY).toBe('price_1AbcTest');
  expect(parsed.data.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL).toBe('price_1XyzTest');
});

it('defaults STRIPE_PRICE_PREMIUM_GOLD_MONTHLY and STRIPE_PRICE_PREMIUM_GOLD_ANNUAL to undefined when absent', () => {
  const parsed = envSchema.safeParse(minimalValidEnv);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('parse failed');
  expect(parsed.data.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY).toBeUndefined();
  expect(parsed.data.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL).toBeUndefined();
});
```

Note: `envSchema` and `minimalValidEnv` must be exported from `apps/api/src/env.ts` (or already are if `env.test.ts` already imports them — read the file before editing to confirm the import names).

- [ ] **Step 2.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/api exec vitest run test/env.test.ts
```

Expected FAIL: properties not on `envSchema`.

- [ ] **Step 2.3 — Add the two env vars to `apps/api/src/env.ts`**

Read the file first to confirm the existing pattern around `STRIPE_PUBLISHABLE_KEY`. Insert after `STRIPE_PUBLISHABLE_KEY` (line ~35):

```ts
  STRIPE_PRICE_PREMIUM_GOLD_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PREMIUM_GOLD_ANNUAL: z.string().optional(),
```

- [ ] **Step 2.4 — Run test, confirm PASS**

```bash
pnpm --filter @jdm/api exec vitest run test/env.test.ts
```

Expected: new `it` blocks PASS. All existing env tests still PASS.

- [ ] **Step 2.5 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN.

- [ ] **Step 2.6 — Commit Task 2**

```bash
git add apps/api/src/env.ts apps/api/test/env.test.ts
git commit -m "$(cat <<'EOF'
feat(api/env): add STRIPE_PRICE_PREMIUM_GOLD_MONTHLY + ANNUAL env vars (F8.09)

Both optional strings; routes validate at call time and return 503 if
missing when billing is enabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Stripe service helpers (`apps/api/src/services/stripe/index.ts`)

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts`

Three new helpers are added to the `StripeClient` type and `buildStripe` factory. They do NOT change any existing method signatures. Read the full file before editing so the exact position of insertions is confirmed.

- [ ] **Step 3.1 — Write the failing tests for the three helpers**

Create `apps/api/test/billing/stripe-service-helpers.test.ts`:

```ts
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStripe } from '../../src/services/stripe/index.js';

// Minimal env for buildStripe; keys are not real — SDK is mocked below.
const testEnv = {
  STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'a'.repeat(26),
  STRIPE_PUBLISHABLE_KEY: undefined,
};

// We mock the Stripe SDK constructor so no real HTTP calls occur.
vi.mock('stripe', () => {
  const mockCreate = vi.fn();
  const mockList = vi.fn();
  const mockCustomersCreate = vi.fn();
  const mockPortalCreate = vi.fn();

  const StripeConstructor = vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: { create: mockCreate },
    },
    customers: {
      list: mockList,
      create: mockCustomersCreate,
    },
    billingPortal: {
      sessions: { create: mockPortalCreate },
    },
  }));

  // Expose mocks so tests can access them.
  (StripeConstructor as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  (StripeConstructor as unknown as Record<string, unknown>).__mockList = mockList;
  (StripeConstructor as unknown as Record<string, unknown>).__mockCustomersCreate =
    mockCustomersCreate;
  (StripeConstructor as unknown as Record<string, unknown>).__mockPortalCreate = mockPortalCreate;

  return { default: StripeConstructor };
});

const getMocks = () => {
  const Constructor = Stripe as unknown as {
    __mockCreate: ReturnType<typeof vi.fn>;
    __mockList: ReturnType<typeof vi.fn>;
    __mockCustomersCreate: ReturnType<typeof vi.fn>;
    __mockPortalCreate: ReturnType<typeof vi.fn>;
  };
  return {
    mockCreate: Constructor.__mockCreate,
    mockList: Constructor.__mockList,
    mockCustomersCreate: Constructor.__mockCustomersCreate,
    mockPortalCreate: Constructor.__mockPortalCreate,
  };
};

describe('createSubscriptionCheckoutSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls stripe.checkout.sessions.create with mode=subscription and subscription_data.metadata', async () => {
    const { mockCreate } = getMocks();
    mockCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
    });

    const client = buildStripe(testEnv);
    const result = await client.createSubscriptionCheckoutSession({
      customerId: 'cus_abc',
      priceId: 'price_monthly',
      successUrl: 'https://app.jdm.com/premium/success',
      cancelUrl: 'https://app.jdm.com/premium',
      metadata: { garageId: 'garage_1', userId: 'user_1' },
      idempotencyKey: 'checkout_sub_garage_1_monthly',
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const [params] = mockCreate.mock.calls[0] as [Stripe.Checkout.SessionCreateParams];
    expect(params.mode).toBe('subscription');
    expect(params.customer).toBe('cus_abc');
    expect(params.line_items).toHaveLength(1);
    expect((params.line_items![0] as { price: string }).price).toBe('price_monthly');
    expect(
      (params.subscription_data as { metadata: Record<string, string> }).metadata.garageId,
    ).toBe('garage_1');
    expect(params.success_url).toBe('https://app.jdm.com/premium/success');
    expect(params.cancel_url).toBe('https://app.jdm.com/premium');
    expect(result).toEqual({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
    });
  });

  it('throws if session has no url', async () => {
    const { mockCreate } = getMocks();
    mockCreate.mockResolvedValue({ id: 'cs_test_123', url: null });

    const client = buildStripe(testEnv);
    await expect(
      client.createSubscriptionCheckoutSession({
        customerId: 'cus_abc',
        priceId: 'price_monthly',
        successUrl: 'https://app.jdm.com/premium/success',
        cancelUrl: 'https://app.jdm.com/premium',
        metadata: {},
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrow('stripe subscription checkout session missing url');
  });
});

describe('findOrCreateCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing customer when found by email', async () => {
    const { mockList } = getMocks();
    mockList.mockResolvedValue({ data: [{ id: 'cus_existing' }] });

    const client = buildStripe(testEnv);
    const result = await client.findOrCreateCustomer({
      email: 'rider@jdm.com',
      garageId: 'garage_1',
    });

    expect(mockList).toHaveBeenCalledWith({ email: 'rider@jdm.com', limit: 1 });
    expect(result).toEqual({ customerId: 'cus_existing' });
  });

  it('creates a new customer when none found', async () => {
    const { mockList, mockCustomersCreate } = getMocks();
    mockList.mockResolvedValue({ data: [] });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });

    const client = buildStripe(testEnv);
    const result = await client.findOrCreateCustomer({
      email: 'new@jdm.com',
      garageId: 'garage_2',
    });

    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: 'new@jdm.com',
      metadata: { garageId: 'garage_2' },
    });
    expect(result).toEqual({ customerId: 'cus_new' });
  });
});

describe('createBillingPortalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls billingPortal.sessions.create and returns url', async () => {
    const { mockPortalCreate } = getMocks();
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' });

    const client = buildStripe(testEnv);
    const result = await client.createBillingPortalSession({
      customerId: 'cus_abc',
      returnUrl: 'https://app.jdm.com/me/billing',
    });

    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_abc',
      return_url: 'https://app.jdm.com/me/billing',
    });
    expect(result).toEqual({ url: 'https://billing.stripe.com/session/abc' });
  });
});
```

- [ ] **Step 3.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/stripe-service-helpers.test.ts
```

Expected FAIL: "createSubscriptionCheckoutSession is not a function" (methods don't exist on `StripeClient` yet).

- [ ] **Step 3.3 — Extend `StripeClient` type and `buildStripe` in `apps/api/src/services/stripe/index.ts`**

Read the existing file before editing (already done during planning). The existing `StripeClient` type ends at line 47. Add three new type entries to the type definition, and three new method implementations inside `buildStripe`.

**Type additions** — insert into the `StripeClient` type block after `publishableKey: () => string`:

```ts
createSubscriptionCheckoutSession: (input: CreateSubscriptionCheckoutSessionInput) =>
  Promise<SubscriptionCheckoutSessionResult>;
findOrCreateCustomer: (input: FindOrCreateCustomerInput) => Promise<FindOrCreateCustomerResult>;
createBillingPortalSession: (input: CreateBillingPortalSessionInput) =>
  Promise<BillingPortalSessionResult>;
```

**New input/result types** — add near the top of the file, after the existing `WebhookEvent` type block and before `StripeEnv`:

```ts
export type CreateSubscriptionCheckoutSessionInput = {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** metadata is attached to both the session and subscription_data so the
   *  webhook handler can resolve garageId from Customer.metadata.garageId. */
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type SubscriptionCheckoutSessionResult = {
  id: string;
  url: string;
};

export type FindOrCreateCustomerInput = {
  email: string;
  garageId: string;
};

export type FindOrCreateCustomerResult = {
  customerId: string;
};

export type CreateBillingPortalSessionInput = {
  customerId: string;
  returnUrl: string;
};

export type BillingPortalSessionResult = {
  url: string;
};
```

**Method implementations** — add inside the `return { ... }` block in `buildStripe`, after `publishableKey`:

```ts
    createSubscriptionCheckoutSession: async ({
      customerId,
      priceId,
      successUrl,
      cancelUrl,
      metadata,
      idempotencyKey,
    }) => {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customerId,
          line_items: [{ price: priceId, quantity: 1 }],
          // subscription_data.metadata carries garageId so the webhook handler
          // can resolve the garage on invoice.paid without an extra DB lookup.
          subscription_data: { metadata },
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
        },
        { idempotencyKey },
      );
      if (!session.url) throw new Error('stripe subscription checkout session missing url');
      return { id: session.id, url: session.url };
    },

    findOrCreateCustomer: async ({ email, garageId }) => {
      // Check for an existing Stripe customer by email first to avoid duplicates.
      // Stripe's customer dedup is email-based; we take the first match.
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0 && existing.data[0]) {
        return { customerId: existing.data[0].id };
      }
      const customer = await stripe.customers.create({
        email,
        // garageId in metadata is the canonical link for webhook resolution
        // (spec §3.1 step 4: Stripe path resolves garageId via Customer.metadata.garageId).
        metadata: { garageId },
      });
      return { customerId: customer.id };
    },

    createBillingPortalSession: async ({ customerId, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },
```

- [ ] **Step 3.4 — Run test, confirm PASS**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/stripe-service-helpers.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3.5 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN.

- [ ] **Step 3.6 — Commit Task 3**

```bash
git add apps/api/src/services/stripe/index.ts apps/api/test/billing/stripe-service-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(api/stripe): add createSubscriptionCheckoutSession + findOrCreateCustomer + createBillingPortalSession (F8.09)

Three new helpers on StripeClient:
- createSubscriptionCheckoutSession: mode='subscription', subscription_data.metadata=garageId
- findOrCreateCustomer: list-by-email first, create only if absent
- createBillingPortalSession: wraps billingPortal.sessions.create

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `me-premium.ts` route plugin

**Files:**

- Create: `apps/api/src/routes/me-premium.ts`

Three endpoints live in one Fastify plugin. All three share a `preHandler: [app.authenticate]`. The flag check is inline at the top of each handler (not a shared hook) so the 503 body is consistent and the handler logic is readable.

- [ ] **Step 4.1 — Write the failing integration tests (full test file)**

Create `apps/api/test/billing/me-premium.test.ts`.

> This test file uses a Testcontainers Postgres database. Read `apps/api/test/helpers.ts` (or the global setup file listed in `vitest.config.ts`) before running to confirm the `makeApp`, `createUser`, `bearer`, and `resetDatabase` helper names match — they were confirmed matching in chunk-35, so the same patterns apply here.

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// We mock the Stripe service so no real Stripe API calls happen.
// The mock returns predictable values; the route's logic (precheck, env lookup,
// customer creation, session creation) is what we are testing.
vi.mock('../../src/services/stripe/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/stripe/index.js')>();
  return {
    ...actual,
    buildStripe: vi.fn().mockReturnValue({
      // Preserve existing helpers (used by other routes in makeApp).
      createPaymentIntent: vi.fn(),
      createCheckoutSession: vi.fn(),
      getCheckoutSessionPaymentIntentId: vi.fn(),
      constructWebhookEvent: vi.fn(),
      refund: vi.fn(),
      cancelPaymentIntent: vi.fn(),
      retrievePaymentIntent: vi.fn(),
      publishableKey: vi.fn().mockReturnValue('pk_test_mock'),
      // New helpers.
      findOrCreateCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_test_mock' }),
      createSubscriptionCheckoutSession: vi.fn().mockResolvedValue({
        id: 'cs_test_mock',
        url: 'https://checkout.stripe.com/pay/cs_test_mock',
      }),
      createBillingPortalSession: vi.fn().mockResolvedValue({
        url: 'https://billing.stripe.com/session/mock',
      }),
    }),
  };
});

// Helper: seed a PremiumMembership row directly in the DB (bypasses webhook path).
const seedMembership = async (
  garageId: string,
  status: 'active' | 'past_due' | 'cancel_scheduled' | 'expired',
  provider: 'stripe' | 'apple_revenuecat' = 'stripe',
  providerCustomerRef = 'cus_seed',
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider,
      providerCustomerRef,
      providerSubRef: `sub_seed_${status}_${Date.now()}`,
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
    },
  });

describe('GET /api/me/premium/checkout-precheck', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: true } });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 { available: true } when user has no live membership', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'free@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
  });

  it('returns 409 AlreadySubscribed with Stripe manageUrl when user has active Stripe membership', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'active_stripe@jdm.test', verified: true });
    // Ensure garage exists (me endpoint creates it lazily; replicate that here).
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_active');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('AlreadySubscribed');
    expect(body.provider).toBe('stripe');
    // manageUrl is a live Stripe portal URL generated via createBillingPortalSession.
    expect(body.manageUrl).toBe('https://billing.stripe.com/session/mock');
    expect(body.available).toBe(false);
  });

  it('returns 409 AlreadySubscribed with App Store manageUrl when user has active Apple membership', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'active_apple@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-apple-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'active', 'apple_revenuecat', 'rc_app_user_id');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('AlreadySubscribed');
    expect(body.provider).toBe('apple_revenuecat');
    expect(body.manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('returns 409 for past_due membership (user still has access, cannot double-subscribe)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'past_due@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-pd-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'past_due');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('AlreadySubscribed');
  });

  it('returns 409 for cancel_scheduled membership (user still has access until period end)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'cancelling@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-cs-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'cancel_scheduled');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('AlreadySubscribed');
  });

  it('returns 200 available=true for expired membership (user can re-subscribe)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'expired@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-exp-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'expired');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
  });

  it('returns 503 when feature flag disabled', async () => {
    await app.close();
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: false } });
    const env = loadEnv();
    const { user } = await createUser({ email: 'flagoff@jdm.test', verified: true });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, user.id, 'user') },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ServiceUnavailable');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/premium/checkout-precheck' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/me/premium/checkout', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp({
      env: {
        GROWTH_PREMIUM_BILLING_ENABLED: true,
        STRIPE_PRICE_PREMIUM_GOLD_MONTHLY: 'price_monthly_test',
        STRIPE_PRICE_PREMIUM_GOLD_ANNUAL: 'price_annual_test',
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 201 { url, sessionId } for monthly cadence (happy path)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'checkout_monthly@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_mock');
    expect(body.sessionId).toBe('cs_test_mock');
  });

  it('returns 201 for annual cadence (happy path)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'checkout_annual@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().url).toContain('checkout.stripe.com');
  });

  it('reuses existing Stripe customer — findOrCreateCustomer called once with correct email', async () => {
    const { buildStripe } = await import('../../src/services/stripe/index.js');
    const mockClient = (buildStripe as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const findOrCreate = mockClient?.findOrCreateCustomer as ReturnType<typeof vi.fn>;
    findOrCreate.mockClear();

    const env = loadEnv();
    const { user } = await createUser({ email: 'reuse_customer@jdm.test', verified: true });

    await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(findOrCreate).toHaveBeenCalledOnce();
    expect(findOrCreate.mock.calls[0][0].email).toBe('reuse_customer@jdm.test');
  });

  it('returns 409 AlreadySubscribed when precheck would fail (live membership exists)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'blocked_checkout@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-block-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'active');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('AlreadySubscribed');
  });

  it('returns 422 for invalid cadence', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'bad_cadence@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'weekly' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('returns 503 when feature flag disabled', async () => {
    await app.close();
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: false } });
    const env = loadEnv();
    const { user } = await createUser({ email: 'flagoff_checkout@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'monthly' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('returns 503 when price env var is missing for chosen cadence', async () => {
    await app.close();
    // Only monthly price configured; annual is absent.
    app = await makeApp({
      env: {
        GROWTH_PREMIUM_BILLING_ENABLED: true,
        STRIPE_PRICE_PREMIUM_GOLD_MONTHLY: 'price_monthly_test',
        // STRIPE_PRICE_PREMIUM_GOLD_ANNUAL intentionally absent
      },
    });
    const env = loadEnv();
    const { user } = await createUser({ email: 'no_price@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/checkout',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { cadence: 'annual' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ServiceUnavailable');
  });
});

describe('POST /api/me/premium/billing-portal', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: true } });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 { url } for Stripe-billed user with active membership', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'portal@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-portal-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'active', 'stripe', 'cus_portal_test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe('https://billing.stripe.com/session/mock');
  });

  it('returns 404 when user has no Stripe membership', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'no_portal@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NotFound');
  });

  it('returns 409 for apple_revenuecat member (Billing Portal is Stripe-only)', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'apple_portal@jdm.test', verified: true });
    const garage = await prisma.garage.upsert({
      where: { userId: user.id },
      create: { userId: user.id, slug: `garage-apple-portal-${user.id}` },
      update: {},
    });
    await seedMembership(garage.id, 'active', 'apple_revenuecat');

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NotStripeSubscription');
    expect(res.json().manageUrl).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('returns 503 when feature flag disabled', async () => {
    await app.close();
    app = await makeApp({ env: { GROWTH_PREMIUM_BILLING_ENABLED: false } });
    const env = loadEnv();
    const { user } = await createUser({ email: 'flagoff_portal@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/billing-portal',
      headers: { authorization: bearer(env, user.id, 'user') },
      payload: { returnUrl: 'https://app.jdm.com/me/billing' },
    });

    expect(res.statusCode).toBe(503);
  });
});
```

- [ ] **Step 4.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts
```

Expected FAIL: "Cannot find module '../../src/routes/me-premium.js'" or equivalent (route not registered yet so endpoints return 404).

- [ ] **Step 4.3 — Implement `apps/api/src/routes/me-premium.ts`**

```ts
import { prisma } from '@jdm/db';
import {
  premiumBillingPortalResponseSchema,
  premiumCheckoutPrecheckResponseSchema,
  premiumCheckoutRequestSchema,
  premiumCheckoutResponseSchema,
} from '@jdm/shared/premium';
import type { FastifyPluginAsync } from 'fastify';

import { requireUser } from '../plugins/auth.js';

/** Deep link for Apple IAP subscription management. iOS App Store policy-mandated URL. */
const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Live membership statuses that block a new subscription (spec §5 + canon §F8.11).
 * `expired` is intentionally excluded — an expired user can re-subscribe.
 */
const LIVE_STATUSES = ['active', 'past_due', 'cancel_scheduled'] as const;

export const mePremiumRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/me/premium/checkout-precheck
   *
   * Returns 200 { available: true } if the user can start a new subscription.
   * Returns 409 { error: 'AlreadySubscribed', provider, manageUrl } if they already
   * have a live membership in any status from LIVE_STATUSES (spec §5).
   *
   * Canon §F8.11: returns 503 when GROWTH_PREMIUM_BILLING_ENABLED is false.
   */
  app.get(
    '/api/me/premium/checkout-precheck',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);

      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });
      if (!garage) {
        // No garage = never subscribed; return available.
        return reply
          .status(200)
          .send(premiumCheckoutPrecheckResponseSchema.parse({ available: true }));
      }

      const liveMembership = await prisma.premiumMembership.findFirst({
        where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
        select: { provider: true, providerCustomerRef: true },
      });

      if (!liveMembership) {
        return reply
          .status(200)
          .send(premiumCheckoutPrecheckResponseSchema.parse({ available: true }));
      }

      // Existing live membership: resolve manage URL by provider.
      let manageUrl: string;
      if (liveMembership.provider === 'stripe') {
        // Generate a live Stripe Billing Portal URL so the user can manage their sub directly.
        const portal = await app.stripe.createBillingPortalSession({
          customerId: liveMembership.providerCustomerRef,
          returnUrl: `${app.env.APP_WEB_BASE_URL}/me/billing`,
        });
        manageUrl = portal.url;
      } else {
        // Apple IAP: Stripe portal is not applicable; point to App Store Settings.
        manageUrl = APPLE_MANAGE_URL;
      }

      return reply.status(409).send(
        premiumCheckoutPrecheckResponseSchema.parse({
          available: false,
          error: 'AlreadySubscribed',
          provider: liveMembership.provider,
          manageUrl,
        }),
      );
    },
  );

  /**
   * POST /api/me/premium/checkout
   *
   * Body: { cadence: 'monthly' | 'annual' }
   *
   * 1. Runs the precheck; aborts with 409 if user already has a live membership.
   * 2. Resolves priceId from env (never trusts client-supplied price IDs).
   * 3. Finds or creates a Stripe Customer with the user's email and garageId in metadata.
   * 4. Creates a Stripe Checkout Session in subscription mode.
   * 5. Returns { url, sessionId }.
   *
   * Canon §F8.11: 503 when flag disabled.
   */
  app.post(
    '/api/me/premium/checkout',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);

      const parsed = premiumCheckoutRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'UnprocessableEntity',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { cadence } = parsed.data;

      // Resolve priceId from env — server-side only; client sends cadence enum only.
      const priceId =
        cadence === 'monthly'
          ? app.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY
          : app.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;

      if (!priceId) {
        request.log.error(
          { cadence },
          'me-premium: checkout requested but price env var not configured',
        );
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'billing price not configured' });
      }

      // Re-run precheck inline to close the race window between GET precheck and POST checkout.
      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });

      if (garage) {
        const liveMembership = await prisma.premiumMembership.findFirst({
          where: { garageId: garage.id, status: { in: [...LIVE_STATUSES] } },
          select: { provider: true, providerCustomerRef: true },
        });

        if (liveMembership) {
          let manageUrl: string;
          if (liveMembership.provider === 'stripe') {
            const portal = await app.stripe.createBillingPortalSession({
              customerId: liveMembership.providerCustomerRef,
              returnUrl: `${app.env.APP_WEB_BASE_URL}/me/billing`,
            });
            manageUrl = portal.url;
          } else {
            manageUrl = APPLE_MANAGE_URL;
          }
          return reply.status(409).send({
            error: 'AlreadySubscribed',
            provider: liveMembership.provider,
            manageUrl,
          });
        }
      }

      // Resolve user email for Stripe Customer lookup/creation.
      const user = await prisma.user.findUnique({ where: { id: sub }, select: { email: true } });
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });

      // Ensure garage exists (lazy creation mirrors the garage route pattern).
      const effectiveGarage =
        garage ??
        (await prisma.garage.upsert({
          where: { userId: sub },
          create: { userId: sub, slug: `garage-${sub}` },
          update: {},
          select: { id: true },
        }));

      const { customerId } = await app.stripe.findOrCreateCustomer({
        email: user.email,
        garageId: effectiveGarage.id,
      });

      // Idempotency key is stable per (garageId, cadence) so double-taps return the
      // same session. Matches the checkout_${order.id} convention in orders.ts.
      const idempotencyKey = `checkout_sub_${effectiveGarage.id}_${cadence}`;

      const session = await app.stripe.createSubscriptionCheckoutSession({
        customerId,
        priceId,
        successUrl: `${app.env.APP_WEB_BASE_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${app.env.APP_WEB_BASE_URL}/premium`,
        metadata: { garageId: effectiveGarage.id, userId: sub, cadence },
        idempotencyKey,
      });

      return reply.status(201).send(premiumCheckoutResponseSchema.parse(session));
    },
  );

  /**
   * POST /api/me/premium/billing-portal
   *
   * Body: { returnUrl: string }
   *
   * Returns a Stripe Billing Portal session URL for the current user's Stripe subscription.
   * Only valid for users with a Stripe (not Apple) membership.
   * Returns 404 if the user has no membership at all.
   * Returns 409 NotStripeSubscription with App Store deep link if the user is on Apple IAP.
   *
   * Canon §F8.11: 503 when flag disabled.
   */
  app.post(
    '/api/me/premium/billing-portal',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
        return reply
          .status(503)
          .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
      }

      const { sub } = requireUser(request);

      // Accept and validate returnUrl from the body; fall back to default if absent.
      const body = request.body as { returnUrl?: string } | null;
      const returnUrl =
        typeof body?.returnUrl === 'string' && body.returnUrl.length > 0
          ? body.returnUrl
          : `${app.env.APP_WEB_BASE_URL}/me/billing`;

      const garage = await prisma.garage.findUnique({
        where: { userId: sub },
        select: { id: true },
      });
      if (!garage) {
        return reply.status(404).send({ error: 'NotFound', message: 'no membership found' });
      }

      // Look for any live or recently expired Stripe membership to find the customerId.
      const membership = await prisma.premiumMembership.findFirst({
        where: {
          garageId: garage.id,
          status: { in: [...LIVE_STATUSES] },
        },
        select: { provider: true, providerCustomerRef: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!membership) {
        return reply.status(404).send({ error: 'NotFound', message: 'no active membership found' });
      }

      if (membership.provider !== 'stripe') {
        // Apple IAP users manage their subscription in the App Store, not Stripe portal.
        return reply.status(409).send({
          error: 'NotStripeSubscription',
          message: 'manage your subscription in the App Store',
          manageUrl: APPLE_MANAGE_URL,
        });
      }

      const portal = await app.stripe.createBillingPortalSession({
        customerId: membership.providerCustomerRef,
        returnUrl,
      });

      return reply.status(200).send(premiumBillingPortalResponseSchema.parse(portal));
    },
  );
};
```

- [ ] **Step 4.4 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN. If `app.stripe.createBillingPortalSession` or `app.stripe.findOrCreateCustomer` are missing from the TypeScript types (because Task 3 edits aren't in place), fix the import or revisit Task 3.

- [ ] **Step 4.5 — Run the tests (expect most to pass, some may fail due to missing `app.ts` registration)**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts
```

If tests fail with 404 (route not found), that is expected — Task 5 registers the route. If tests fail for other reasons (compile error, missing method), fix those first.

---

## Task 5 — Register route in `app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 5.1 — Add the import**

Add to the import block in `apps/api/src/app.ts`, alphabetically after `import { meShippingAddressRoutes }`:

```ts
import { mePremiumRoutes } from './routes/me-premium.js';
```

- [ ] **Step 5.2 — Register the route**

Inside the `buildApp` function, add after `await app.register(meSupportRoutes)`:

```ts
await app.register(mePremiumRoutes);
```

- [ ] **Step 5.3 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN.

- [ ] **Step 5.4 — Run the full test suite for this chunk**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5.5 — Commit Tasks 3 + 4 + 5 together**

```bash
git add \
  apps/api/src/routes/me-premium.ts \
  apps/api/src/app.ts \
  apps/api/src/env.ts \
  apps/api/test/billing/me-premium.test.ts \
  apps/api/test/billing/stripe-service-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(api): me-premium routes + Stripe checkout/portal helpers (F8.09)

Three endpoints behind GROWTH_PREMIUM_BILLING_ENABLED flag (canon §F8.11):
- GET /api/me/premium/checkout-precheck: 200/409 duplicate-subscribe guard (spec §5)
- POST /api/me/premium/checkout: findOrCreateCustomer + subscription checkout session
- POST /api/me/premium/billing-portal: Stripe Billing Portal session URL

Three new helpers on StripeClient (services/stripe/index.ts):
findOrCreateCustomer, createSubscriptionCheckoutSession,
createBillingPortalSession.

Price IDs resolved from env (STRIPE_PRICE_PREMIUM_GOLD_MONTHLY/ANNUAL).
Apple IAP members directed to App Store deep link, not Stripe portal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Final verification

- [ ] **Step 6.1 — Rebuild shared + run all touched tests**

Stop and fix at the first failure.

```bash
# 1. Shared
pnpm --filter @jdm/shared build
pnpm --filter @jdm/shared exec vitest run src/__tests__/premium.test.ts

# 2. API
pnpm --filter @jdm/api typecheck
pnpm --filter @jdm/api exec vitest run test/env.test.ts
pnpm --filter @jdm/api exec vitest run test/billing/stripe-service-helpers.test.ts
pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts
```

`pnpm --filter @jdm/shared build` is required before API tests (CLAUDE.md `feedback_rebuild_shared_after_schema_change.md`). Per `feedback_no_full_test_suite_locally.md`, only the new/touched files run. Per `feedback_no_background_shells.md`, all commands are one-shot.

- [ ] **Step 6.2 — Commit Task 6 if any fixes were needed**

If no fixes were needed, proceed directly to Task 7.

---

## Task 7 — PR

- [ ] **Step 7.1 — Push**

```bash
git push -u origin feat/jdma-f8-billing-09
```

- [ ] **Step 7.2 — Open PR (`gh pr create --base main`)**

```bash
gh pr create --title "feat(api): Stripe checkout + portal routes + duplicate-subscribe precheck (F8.09)" --body "$(cat <<'EOF'
## Summary

- Three new endpoints under `GET/POST /api/me/premium/*` (feature-flagged per canon §F8.11, `GROWTH_PREMIUM_BILLING_ENABLED`)
- `GET /api/me/premium/checkout-precheck` — duplicate-subscribe guard (spec §5): queries `PremiumMembership WHERE status IN ('active','past_due','cancel_scheduled')`, returns 200 `{ available: true }` or 409 `{ AlreadySubscribed, provider, manageUrl }`
- `POST /api/me/premium/checkout` — resolves `priceId` from env (`STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` / `_ANNUAL`), calls `findOrCreateCustomer` + `createSubscriptionCheckoutSession` (mode=subscription, metadata.garageId), returns `{ url, sessionId }`
- `POST /api/me/premium/billing-portal` — returns Stripe Billing Portal URL for Stripe users; directs Apple IAP users to `https://apps.apple.com/account/subscriptions`
- Three new helpers on `StripeClient` in `services/stripe/index.ts`: `findOrCreateCustomer` (list-by-email-first dedup), `createSubscriptionCheckoutSession`, `createBillingPortalSession`
- New `packages/shared/src/premium.ts` with `premiumCheckoutRequestSchema`, `premiumCheckoutResponseSchema`, `premiumCheckoutPrecheckResponseSchema`, `premiumBillingPortalResponseSchema`
- `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` + `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL` added to `apps/api/src/env.ts` (optional; 503 if absent when billing flag is on)

## Out of scope

- Webhook activation (`F8.04` — Stripe billing webhook that writes `PremiumMembership`)
- Premium status endpoint (`F8.11`)
- Web `/premium` pricing page UI (`F8.17`)
- Mobile RC purchase flow (`F8.10`, `F8.18`)

## Deviations from skeleton

- `billing-portal` returns `409 NotStripeSubscription` (with `manageUrl`) for Apple members instead of 404 — more useful to clients that want to direct the user to the correct management surface without a separate provider check
- Inline precheck re-run inside `POST /checkout` to close the race window between GET precheck and POST checkout (belt-and-suspenders beyond the DB-level partial unique)
- `makeApp` receives env overrides in tests to control `GROWTH_PREMIUM_BILLING_ENABLED` per test; this pattern was already established by prior me-* route tests

## Test plan

- [ ] `pnpm --filter @jdm/shared build` — shared compiles with new `./premium` subpath
- [ ] `pnpm --filter @jdm/shared exec vitest run src/__tests__/premium.test.ts` — 9 schema tests PASS
- [ ] `pnpm --filter @jdm/api typecheck` — GREEN
- [ ] `pnpm --filter @jdm/api exec vitest run test/env.test.ts` — env vars present, defaults undefined
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/stripe-service-helpers.test.ts` — 5 Stripe helper tests PASS
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts` — all precheck/checkout/portal tests PASS

## Canon refs

§F8.11 (feature flag — 503 when disabled), §F8.12 (filtered test cmd), §F8.13 (rebuild shared after schema change). Spec §5 (precheck shape), §8.2 (web subscribe flow).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR opens against `main`. Never `production`.

---

## Cross-references

- Skeleton: `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.09.
- Spec (canonical): `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §5 (precheck), §8.2 (web subscribe), §8.3 (shared schemas).
- Stripe service file (extend): `apps/api/src/services/stripe/index.ts`.
- Existing me-\* route pattern reference: `apps/api/src/routes/me.ts`.
- Idempotency key convention reference: `apps/api/src/routes/orders.ts:555` (`checkout_${order.id}`).
- Format analog (chunk-35): `docs/superpowers/plans/2026-05-24-phase2-chunks/chunk-35-admin-xp-adjustment-route.md`.

## Self-review checklist (before requesting review)

- [ ] Branch `feat/jdma-f8-billing-09`, cut from fresh `main`. `F8.01` (`PremiumMembership` model) is on `main`.
- [ ] `packages/shared/package.json` has `./premium` subpath. `pnpm --filter @jdm/shared build` ran successfully; `dist/premium.js` exists.
- [ ] `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` + `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL` are in `apps/api/src/env.ts` as optional strings.
- [ ] `StripeClient` type has the three new methods. `buildStripe` returns implementations for all three.
- [ ] `findOrCreateCustomer` calls `stripe.customers.list({ email, limit: 1 })` first; creates only if `data.length === 0`.
- [ ] `createSubscriptionCheckoutSession` uses `mode: 'subscription'`, attaches `subscription_data: { metadata }` with `garageId`, passes `idempotencyKey`.
- [ ] All three route handlers check `app.env.GROWTH_PREMIUM_BILLING_ENABLED` at entry and return 503 if false (canon §F8.11).
- [ ] Precheck checks `status IN ('active','past_due','cancel_scheduled')` — `expired` is excluded so expired users can re-subscribe.
- [ ] Precheck generates a live Stripe Billing Portal URL for Stripe users (not a static string).
- [ ] Checkout re-runs the precheck inline before creating a session (race guard).
- [ ] Billing-portal returns 409 `NotStripeSubscription` + `manageUrl = APPLE_MANAGE_URL` for `apple_revenuecat` members.
- [ ] Test for "existing customer reused" asserts `findOrCreateCustomer` called once with correct email.
- [ ] Test for "price env var missing" returns 503 (not 500).
- [ ] PR body lists deviations from skeleton.
- [ ] PR opens against `main`, never `production`.
