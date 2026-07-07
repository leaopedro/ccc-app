# F8.20 — Public Premium Pricing Route (Gap #4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a single **unauthed** `GET /api/premium/pricing` endpoint that resolves the two Stripe Prices for the Gold tier (monthly + annual) from env-configured price IDs, parses `baseAmountCents` + `devFeePercent` from `Stripe.Price.metadata` (canon §F8.1), computes `devFeeCents` + `grossAmountCents`, and returns the catalog under a new `premiumPricingResponseSchema` zod schema in `@jdm/shared/premium`. The endpoint exists so the web subscribe page (F8.17) and the mobile premium screen (F8.18) can render pricing without forcing a login first.

**Architecture:** New Fastify plugin `apps/api/src/routes/premium-pricing.ts` registered in `app.ts`. The plugin has NO `preHandler: [app.authenticate]` — anonymous callers receive the same response as logged-in users. The plugin gate-checks `env.GROWTH_PREMIUM_BILLING_ENABLED` (canon §F8.11) on every request, returning `503` when disabled. The handler reads `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` + `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL` from env (both already in `apps/api/src/env.ts` per F8.09); if either is absent it returns `503`. It then calls a new `app.stripe.retrievePrice` helper for each ID, parses `metadata.baseAmountCents` + `metadata.devFeePercent` as integers, computes `devFeeCents = Math.round(baseAmountCents * devFeePercent / 100)` and `grossAmountCents = baseAmountCents + devFeeCents` (canon §F8.1 + canon "Stripe gross formula `gross = base + devFee`"), and returns the parsed shape via the new `premiumPricingResponseSchema`.

**Tech Stack:** Fastify 4, Stripe Node SDK (existing `buildStripe` client extended with one new method), zod 3, `@jdm/shared/premium` (existing subpath — extended with one new schema), vitest + Testcontainers Postgres (for the app boot — the route itself is stateless).

---

## Branch safety preflight (CLAUDE.md)

```bash
git branch --show-current
# If `production` → STOP. Switch to main first.
git checkout main && git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-20
```

## Dependencies on prior chunks

Assumes on `main` before execution:

- **F8.01** — `GROWTH_PREMIUM_BILLING_ENABLED` in `env.ts`. Verified on `main`.
- **F8.09** — `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` + `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL` env vars + `@jdm/shared/premium` subpath. Verified on `main`.
- **F8.11** — `premiumStatusSchema` in `@jdm/shared/premium`. Verified on `main`. Coexists with the new pricing schema in the same file.

If F8.09 has NOT landed, STOP and run that chunk first.

## Corrections + canon refs

- **§F8.11 — Feature flag.** The route gates on `env.GROWTH_PREMIUM_BILLING_ENABLED`. Disabled → `503 { error: 'ServiceUnavailable', message: 'premium billing not available' }`. Do NOT return `404`.
- **§F8.12 — Filtered test command.** `pnpm --filter @jdm/api exec vitest run test/billing/premium-pricing.test.ts` — note `exec vitest run`, never `pnpm --filter @jdm/api test -- ...`.
- **§F8.13 — Rebuild @jdm/shared.** After adding `premiumPricingResponseSchema` + `premiumPricingEntrySchema` exports to `packages/shared/src/premium.ts`, run `pnpm --filter @jdm/shared build` before running API tests.
- **§F8.1 — devfee storage.** The Stripe Price metadata keys are `baseAmountCents` + `devFeePercent` (verified on `main` against `apps/api/src/workers/billing-reconcile.ts:79-83` + `apps/api/src/services/billing/normalize-stripe.ts:205-206`). Do **NOT** use `devFeeCents` as a metadata key — that name appears in some draft docs but is not what the rest of F8 reads.
- **Canon — Stripe gross formula.** `grossAmountCents = baseAmountCents + devFeeCents`, with `devFeeCents = Math.round(baseAmountCents * devFeePercent / 100)`. Use integer cents throughout; never floats.
- **Unauthed by design.** Spec §8.2 calls the web `/premium` route a pricing page (no login required). The mobile premium screen (F8.18) renders pricing before the user signs in. The endpoint MUST NOT carry `preHandler: [app.authenticate]`. The reviewer checklist asserts this.
- **No PII / user-scoped data.** The response is plan-level static. The handler MUST NOT read `request.headers.authorization` or `request.user`.
- **Currency.** Return the upper-cased ISO 4217 code from `Stripe.Price.currency` (Stripe returns lowercase). Spec says BRL; do not hardcode — let Stripe be source-of-truth.

---

## File Structure

```
packages/shared/src/premium.ts                   (modify — append premiumPricingEntry + premiumPricingResponse schemas)
packages/shared/src/__tests__/premium-pricing.test.ts   (new — schema parsing tests)
apps/api/src/services/stripe/index.ts            (modify — add retrievePrice helper)
apps/api/src/services/stripe/fake.ts             (modify — add nextRetrievedPrice field + retrievePrice stub on FakeStripe)
apps/api/src/routes/premium-pricing.ts           (new — Fastify plugin, single GET route)
apps/api/src/app.ts                              (modify — register premiumPricingRoutes)
apps/api/test/billing/premium-pricing.test.ts    (new — integration tests against real Postgres + FakeStripe)
apps/api/test/billing/stripe-retrieve-price.test.ts   (new — unit test for retrievePrice via mocked Stripe SDK)
```

Eight files total: 4 new + 4 modified. `fake.ts` is load-bearing because `FakeStripe = StripeClient & {...}` will not typecheck once `StripeClient` gains `retrievePrice` unless the fake also gains an implementation.

**Responsibility boundaries:**

- `packages/shared/src/premium.ts` — append-only edit. zod schemas + inferred types. No logic. Existing `premiumStatusSchema`, `premiumCheckoutRequestSchema`, etc. are NOT touched.
- `apps/api/src/services/stripe/index.ts` — append one new method to the `StripeClient` type + one implementation in `buildStripe`. Existing methods are NOT touched.
- `apps/api/src/services/stripe/fake.ts` — append one new mutable field (`nextRetrievedPrice: Stripe.Price | null = null`) and one `retrievePrice` implementation that returns it (throws when null so tests fail loudly if they forget to seed). Existing fake fields are NOT touched. The `FakeCall` union gains a `'retrievePrice'` literal so call tracking works.
- `apps/api/src/routes/premium-pricing.ts` — single GET handler. Reads `app.env`, calls `app.stripe.retrievePrice`, returns the parsed response. No Prisma. No `requireUser`. No `preHandler`.
- `apps/api/test/billing/premium-pricing.test.ts` — Testcontainers Postgres (the app boots with one, even though this route doesn't touch it). Uses the real `buildFakeStripe()` and overrides `stripe.retrievePrice` per test for monthly/annual divergence + error paths.
- `apps/api/test/billing/stripe-retrieve-price.test.ts` — unit test for the new `retrievePrice` helper. Mocks the Stripe SDK directly via `vi.mock('stripe', ...)`.

---

## Task 1 — Shared zod schemas (`packages/shared/src/premium.ts`)

**Files:**

- Modify: `packages/shared/src/premium.ts` (append at end of file)
- Create: `packages/shared/src/__tests__/premium-pricing.test.ts`

- [ ] **Step 1.1 — Write the failing test for the schemas**

Create `packages/shared/src/__tests__/premium-pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { premiumPricingEntrySchema, premiumPricingResponseSchema } from '../premium.js';

const validMonthly = {
  priceId: 'price_monthly_test',
  cadence: 'monthly' as const,
  baseAmountCents: 2990,
  devFeePercent: 10,
  devFeeCents: 299,
  grossAmountCents: 3289,
  currency: 'BRL',
};

const validAnnual = {
  priceId: 'price_annual_test',
  cadence: 'annual' as const,
  baseAmountCents: 29900,
  devFeePercent: 10,
  devFeeCents: 2990,
  grossAmountCents: 32890,
  currency: 'BRL',
};

describe('premiumPricingEntrySchema', () => {
  it('accepts a valid monthly entry', () => {
    expect(premiumPricingEntrySchema.parse(validMonthly)).toEqual(validMonthly);
  });

  it('accepts a valid annual entry', () => {
    expect(premiumPricingEntrySchema.parse(validAnnual)).toEqual(validAnnual);
  });

  it('rejects negative baseAmountCents', () => {
    expect(() =>
      premiumPricingEntrySchema.parse({ ...validMonthly, baseAmountCents: -100 }),
    ).toThrow();
  });

  it('rejects non-integer baseAmountCents', () => {
    expect(() =>
      premiumPricingEntrySchema.parse({ ...validMonthly, baseAmountCents: 29.9 }),
    ).toThrow();
  });

  it('rejects devFeePercent above 100', () => {
    expect(() =>
      premiumPricingEntrySchema.parse({ ...validMonthly, devFeePercent: 150 }),
    ).toThrow();
  });

  it('rejects negative devFeePercent', () => {
    expect(() => premiumPricingEntrySchema.parse({ ...validMonthly, devFeePercent: -1 })).toThrow();
  });

  it('rejects currency with wrong length', () => {
    expect(() => premiumPricingEntrySchema.parse({ ...validMonthly, currency: 'BRLX' })).toThrow();
  });

  it('rejects unknown cadence', () => {
    expect(() => premiumPricingEntrySchema.parse({ ...validMonthly, cadence: 'weekly' })).toThrow();
  });
});

describe('premiumPricingResponseSchema', () => {
  it('accepts both entries together', () => {
    const result = premiumPricingResponseSchema.parse({
      monthly: validMonthly,
      annual: validAnnual,
    });
    expect(result.monthly.cadence).toBe('monthly');
    expect(result.annual.cadence).toBe('annual');
  });

  it('rejects when monthly is missing', () => {
    expect(() => premiumPricingResponseSchema.parse({ annual: validAnnual })).toThrow();
  });

  it('rejects when annual is missing', () => {
    expect(() => premiumPricingResponseSchema.parse({ monthly: validMonthly })).toThrow();
  });
});
```

- [ ] **Step 1.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/shared exec vitest run src/__tests__/premium-pricing.test.ts
```

Expected FAIL: `premiumPricingEntrySchema` and `premiumPricingResponseSchema` are not exported from `../premium.js`.

- [ ] **Step 1.3 — Append schemas to `packages/shared/src/premium.ts`**

Append at the end of the file (after the existing `PremiumStatus` type export, line ~93):

```ts
/**
 * GET /api/premium/pricing — single entry (one cadence).
 * Reflects the snapshot from Stripe.Price.metadata at request time:
 *   baseAmountCents — pre-devfee amount the user owes for the plan
 *   devFeePercent   — percent of baseAmountCents added on top as platform fee
 *   devFeeCents     — Math.round(baseAmountCents * devFeePercent / 100)
 *   grossAmountCents — baseAmountCents + devFeeCents (canon: Stripe gross formula)
 *
 * Canon §F8.1: devfee values are snapshotted from Stripe Price metadata, not
 * re-derived from env. Currency is the upper-cased ISO 4217 code from Stripe.
 */
export const premiumPricingEntrySchema = z.object({
  priceId: z.string().min(1),
  cadence: z.enum(['monthly', 'annual']),
  baseAmountCents: z.number().int().nonnegative(),
  devFeePercent: z.number().int().min(0).max(100),
  devFeeCents: z.number().int().nonnegative(),
  grossAmountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export type PremiumPricingEntry = z.infer<typeof premiumPricingEntrySchema>;

/**
 * GET /api/premium/pricing — full response.
 * Always returns both cadences (monthly + annual). If either Stripe Price
 * cannot be resolved, the route returns 503, NOT a partial response.
 */
export const premiumPricingResponseSchema = z.object({
  monthly: premiumPricingEntrySchema,
  annual: premiumPricingEntrySchema,
});

export type PremiumPricingResponse = z.infer<typeof premiumPricingResponseSchema>;
```

- [ ] **Step 1.4 — Run test, confirm PASS**

```bash
pnpm --filter @jdm/shared exec vitest run src/__tests__/premium-pricing.test.ts
```

Expected: 11 cases PASS.

- [ ] **Step 1.5 — Rebuild `@jdm/shared` (canon §F8.13)**

```bash
pnpm --filter @jdm/shared build
```

Expected: success. `dist/premium.js` + `dist/premium.d.ts` carry the two new exports. The `./premium` subpath in `packages/shared/package.json` already exists from F8.09 — DO NOT touch `package.json`.

- [ ] **Step 1.6 — Commit Task 1**

```bash
git add packages/shared/src/premium.ts packages/shared/src/__tests__/premium-pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): premiumPricingEntrySchema + premiumPricingResponseSchema (F8.20)

Two new schemas in @jdm/shared/premium for the public pricing endpoint:
premiumPricingEntrySchema (priceId, cadence, baseAmountCents, devFeePercent,
devFeeCents, grossAmountCents, currency) and premiumPricingResponseSchema
({ monthly, annual }). Imported by the new GET /api/premium/pricing route
in F8.20 and by F8.17 + F8.18 to render pricing UI without an auth context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Stripe service helper `retrievePrice` + fake-side stub

**Files:**

- Modify: `apps/api/src/services/stripe/index.ts`
- Modify: `apps/api/src/services/stripe/fake.ts`

A single new helper is appended to `StripeClient` + `buildStripe`. Because `FakeStripe = StripeClient & {...}` (see `apps/api/src/services/stripe/fake.ts`), `apps/api/test/helpers.ts`'s `makeAppWithFakeStripe()` and every test using `buildFakeStripe()` will FAIL to typecheck once the type gains `retrievePrice` unless the fake also gains an implementation. So the fake edit is part of the same task. Existing helpers and types are NOT touched.

- [ ] **Step 2.1 — Write the failing test for `retrievePrice`**

Create `apps/api/test/billing/stripe-retrieve-price.test.ts`:

```ts
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStripe } from '../../src/services/stripe/index.js';

const testEnv = {
  STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'a'.repeat(26),
  STRIPE_PUBLISHABLE_KEY: undefined,
};

vi.mock('stripe', () => {
  const mockRetrieve = vi.fn();
  const StripeConstructor = vi.fn().mockImplementation(() => ({
    prices: { retrieve: mockRetrieve },
  }));
  (StripeConstructor as unknown as Record<string, unknown>).__mockRetrieve = mockRetrieve;
  return { default: StripeConstructor };
});

const getMocks = () => {
  const Constructor = Stripe as unknown as {
    __mockRetrieve: ReturnType<typeof vi.fn>;
  };
  return { mockRetrieve: Constructor.__mockRetrieve };
};

describe('retrievePrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Stripe.Price with metadata intact', async () => {
    const { mockRetrieve } = getMocks();
    mockRetrieve.mockResolvedValue({
      id: 'price_monthly_test',
      currency: 'brl',
      metadata: { baseAmountCents: '2990', devFeePercent: '10' },
      active: true,
    });

    const client = buildStripe(testEnv);
    const price = await client.retrievePrice('price_monthly_test');

    expect(mockRetrieve).toHaveBeenCalledWith('price_monthly_test');
    expect(price.id).toBe('price_monthly_test');
    expect(price.currency).toBe('brl');
    expect(price.metadata).toEqual({ baseAmountCents: '2990', devFeePercent: '10' });
  });

  it('propagates Stripe errors', async () => {
    const { mockRetrieve } = getMocks();
    mockRetrieve.mockRejectedValue(new Error('No such price: price_missing'));

    const client = buildStripe(testEnv);
    await expect(client.retrievePrice('price_missing')).rejects.toThrow(
      'No such price: price_missing',
    );
  });
});
```

- [ ] **Step 2.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/stripe-retrieve-price.test.ts
```

Expected FAIL: `client.retrievePrice is not a function` (method doesn't exist on `StripeClient` yet).

- [ ] **Step 2.3 — Add `retrievePrice` to `apps/api/src/services/stripe/index.ts`**

Read the file before editing to locate the exact insertion points. There are TWO insertions:

**1. Add to the `StripeClient` type** (already a multi-line block ending around line 116). Insert after the existing `listOpenSubscriptionCheckoutSessions: (...)` line, before the closing `};`:

```ts
/**
 * Retrieve a Stripe Price by ID. Used by the public pricing route (F8.20)
 * to read metadata (`baseAmountCents`, `devFeePercent`) at request time so
 * the UI shows whatever Stripe currently has configured, even if env
 * snapshot drift occurs.
 */
retrievePrice: (priceId: string) => Promise<Stripe.Price>;
```

**2. Add the implementation inside the `return { ... }` block of `buildStripe`.** Append after the `listOpenSubscriptionCheckoutSessions` implementation:

```ts
    retrievePrice: async (priceId) => {
      return stripe.prices.retrieve(priceId);
    },
```

- [ ] **Step 2.4 — Run test, confirm PASS**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/stripe-retrieve-price.test.ts
```

Expected: 2 cases PASS.

- [ ] **Step 2.5 — Extend `apps/api/src/services/stripe/fake.ts` with the matching stub**

Read the file first. The shape is `FakeStripe = StripeClient & {...}` with one mutable `next*` field per "result-shaped" helper and a `calls: FakeCall[]` recorder. Make exactly four additive edits:

**a.** Extend the `FakeCall` union type with the new literal:

```ts
// Before (somewhere near the top):
export type FakeCall =
  | 'createPaymentIntent'
  | ...
  | 'listOpenSubscriptionCheckoutSessions';

// After:
export type FakeCall =
  | 'createPaymentIntent'
  | ...
  | 'listOpenSubscriptionCheckoutSessions'
  | 'retrievePrice';
```

(Convert the prior terminator to a comma; add the new literal. No other lines change.)

**b.** Add a mutable next-value field to the `FakeStripe` interface alongside the other `next*` fields:

```ts
nextRetrievedPrice: import('stripe').default.Price | null;
```

(Match the import style used by neighboring `next*` fields. If the file already has `import type Stripe from 'stripe'`, use `Stripe.Price | null` instead.)

**c.** Initialize the field in `buildFakeStripe()` next to the other `next*` initializers:

```ts
nextRetrievedPrice: null,
```

**d.** Add the `retrievePrice` implementation in the returned object, alongside the other method impls:

```ts
retrievePrice: async (_priceId) => {
  this.calls.push('retrievePrice');
  if (!this.nextRetrievedPrice) {
    throw new Error('FakeStripe.retrievePrice called without nextRetrievedPrice seeded');
  }
  return this.nextRetrievedPrice;
},
```

(Use whatever `this`-binding pattern the file already uses for the other impls. If the existing impls use a closed-over `state` object instead of `this`, follow that pattern.)

Tests will override `stripe.retrievePrice = vi.fn(...)` per-test when they need different prices for monthly vs annual or when they need a rejection — the `nextRetrievedPrice` field is the simple default path; reassignment is the divergent path.

- [ ] **Step 2.6 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN. If you see `Property 'retrievePrice' is missing in type 'FakeStripe'`, Step 2.5 was incomplete.

- [ ] **Step 2.7 — Verify no existing test broke**

The fake.ts edit is additive; existing tests should not regress. Run the F8.09 + F8.11 me-premium tests as a regression guard:

```bash
pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts
```

Expected: all existing cases still PASS.

- [ ] **Step 2.8 — Commit Task 2**

```bash
git add \
  apps/api/src/services/stripe/index.ts \
  apps/api/src/services/stripe/fake.ts \
  apps/api/test/billing/stripe-retrieve-price.test.ts
git commit -m "$(cat <<'EOF'
feat(api/stripe): add retrievePrice helper + FakeStripe stub for public pricing route (F8.20)

Thin pass-through over stripe.prices.retrieve on the real client. Required
FakeStripe addition (nextRetrievedPrice field + retrievePrice impl + FakeCall
literal) so apps/api/test/helpers.ts's buildFakeStripe() + every existing
test that uses it continues to typecheck.

Used by the new GET /api/premium/pricing route to surface monthly + annual
catalog without forcing the caller to know Stripe SDK internals.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `premium-pricing.ts` route plugin

**Files:**

- Create: `apps/api/src/routes/premium-pricing.ts`

Single endpoint, single Fastify plugin, NO `preHandler`. The flag check + env presence check happen inline at the top of the handler.

- [ ] **Step 3.1 — Write the failing integration tests (full test file)**

Create `apps/api/test/billing/premium-pricing.test.ts`.

> **Test pattern (LOAD-BEARING):** `apps/api/test/helpers.ts` exports `makeApp = () => buildApp(loadEnv())` — it does NOT accept an `env` override. The F8.09 `me-premium.test.ts` solves this by:
>
> 1. Reading the relevant `process.env` keys ONCE at module load (`originalFlag`, `originalMonthly`, `originalAnnual`).
> 2. A local `buildPremiumApp(flagEnabled, priceEnv)` helper that mutates `process.env` THEN calls `buildApp(loadEnv(), { stripe })` with a `buildFakeStripe()` instance.
> 3. A module-level `restoreEnv()` called in `afterEach` to revert mutations.
>
> The pricing-route test follows the same pattern. Tests that need different prices for monthly vs annual reassign `stripe.retrievePrice = vi.fn(...)` directly (the fake's `nextRetrievedPrice` field handles the same-shape default case). See `apps/api/test/billing/me-premium.test.ts:25-93` for the canonical reference.

```ts
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { buildFakeStripe, type FakeStripe } from '../../src/services/stripe/fake.js';
import { resetDatabase } from '../helpers.js';

const originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
const originalMonthly = process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
const originalAnnual = process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;

const restoreEnv = () => {
  if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  if (originalMonthly === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = originalMonthly;
  if (originalAnnual === undefined) delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  else process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = originalAnnual;
};

type PriceEnv = { monthly?: string | undefined; annual?: string | undefined };

const buildPricingApp = async (
  flagEnabled: boolean,
  priceEnv: PriceEnv = {
    monthly: 'price_monthly_test',
    annual: 'price_annual_test',
  },
): Promise<{ app: FastifyInstance; stripe: FakeStripe }> => {
  process.env.GROWTH_PREMIUM_BILLING_ENABLED = flagEnabled ? 'true' : 'false';
  if (priceEnv.monthly !== undefined) {
    process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY = priceEnv.monthly;
  } else {
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
  }
  if (priceEnv.annual !== undefined) {
    process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL = priceEnv.annual;
  } else {
    delete process.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;
  }
  const stripe = buildFakeStripe();
  const app = await buildApp(loadEnv(), { stripe });
  return { app, stripe };
};

const errorOf = (res: { json: () => unknown }) => res.json() as { error: string; message?: string };

describe('GET /api/premium/pricing', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    if (app) await app.close();
    restoreEnv();
  });

  afterAll(() => {
    restoreEnv();
  });

  it('returns 200 with both cadences when flag on + both env vars present + Stripe returns valid metadata', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(async (priceId: string) => {
      if (priceId === 'price_monthly_test') {
        return {
          id: 'price_monthly_test',
          currency: 'brl',
          metadata: { baseAmountCents: '2990', devFeePercent: '10' },
          active: true,
        } as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>;
      }
      return {
        id: 'price_annual_test',
        currency: 'brl',
        metadata: { baseAmountCents: '29900', devFeePercent: '10' },
        active: true,
      } as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>;
    });

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      monthly: {
        priceId: 'price_monthly_test',
        cadence: 'monthly',
        baseAmountCents: 2990,
        devFeePercent: 10,
        devFeeCents: 299,
        grossAmountCents: 3289,
        currency: 'BRL',
      },
      annual: {
        priceId: 'price_annual_test',
        cadence: 'annual',
        baseAmountCents: 29900,
        devFeePercent: 10,
        devFeeCents: 2990,
        grossAmountCents: 32890,
        currency: 'BRL',
      },
    });
    expect(stripe.retrievePrice).toHaveBeenCalledTimes(2);
  });

  it('responds identically with no auth header (route is unauthed)', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(
      async (priceId: string) =>
        ({
          id: priceId,
          currency: 'brl',
          metadata: { baseAmountCents: '2990', devFeePercent: '10' },
          active: true,
        }) as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>,
    );

    const noAuthRes = await app.inject({ method: 'GET', url: '/api/premium/pricing' });
    const badAuthRes = await app.inject({
      method: 'GET',
      url: '/api/premium/pricing',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    // Both return 200 — no 401, no 403. Auth has no effect on this route.
    expect(noAuthRes.statusCode).toBe(200);
    expect(badAuthRes.statusCode).toBe(200);
  });

  it('returns 503 when feature flag disabled', async () => {
    const { app: built } = await buildPricingApp(false);
    app = built;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });

  it('returns 503 when STRIPE_PRICE_PREMIUM_GOLD_MONTHLY env is missing', async () => {
    const { app: built } = await buildPricingApp(true, {
      monthly: undefined,
      annual: 'price_annual_test',
    });
    app = built;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });

  it('returns 503 when STRIPE_PRICE_PREMIUM_GOLD_ANNUAL env is missing', async () => {
    const { app: built } = await buildPricingApp(true, {
      monthly: 'price_monthly_test',
      annual: undefined,
    });
    app = built;

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });

  it('returns 500 when Stripe Price metadata.baseAmountCents is missing', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(
      async (priceId: string) =>
        ({
          id: priceId,
          currency: 'brl',
          metadata: { devFeePercent: '10' }, // baseAmountCents missing
          active: true,
        }) as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>,
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).error).toBe('PricingMetadataMissing');
  });

  it('returns 500 when Stripe Price metadata.devFeePercent is missing', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(
      async (priceId: string) =>
        ({
          id: priceId,
          currency: 'brl',
          metadata: { baseAmountCents: '2990' }, // devFeePercent missing
          active: true,
        }) as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>,
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).error).toBe('PricingMetadataMissing');
  });

  it('returns 500 when Stripe Price metadata.baseAmountCents is non-numeric', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(
      async (priceId: string) =>
        ({
          id: priceId,
          currency: 'brl',
          metadata: { baseAmountCents: 'twenty-nine ninety', devFeePercent: '10' },
          active: true,
        }) as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>,
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(500);
    expect(errorOf(res).error).toBe('PricingMetadataMissing');
  });

  it('upper-cases currency from Stripe (Stripe returns lowercase)', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(
      async (priceId: string) =>
        ({
          id: priceId,
          currency: 'usd', // lowercase like the real Stripe SDK returns
          metadata: { baseAmountCents: '999', devFeePercent: '10' },
          active: true,
        }) as unknown as Awaited<ReturnType<FakeStripe['retrievePrice']>>,
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { monthly: { currency: string }; annual: { currency: string } };
    expect(body.monthly.currency).toBe('USD');
    expect(body.annual.currency).toBe('USD');
  });

  it('returns 503 when Stripe Price retrieval throws', async () => {
    const { app: built, stripe } = await buildPricingApp(true);
    app = built;
    stripe.retrievePrice = vi.fn(() =>
      Promise.reject(new Error('No such price: price_monthly_test')),
    );

    const res = await app.inject({ method: 'GET', url: '/api/premium/pricing' });

    expect(res.statusCode).toBe(503);
    expect(errorOf(res).error).toBe('ServiceUnavailable');
  });
});
```

- [ ] **Step 3.2 — Run test, confirm FAIL**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/premium-pricing.test.ts
```

Expected FAIL: 404 (route not registered yet) on the happy-path test.

- [ ] **Step 3.3 — Implement `apps/api/src/routes/premium-pricing.ts`**

```ts
/**
 * premium-pricing route — F8.20 (gap #4).
 *
 * GET /api/premium/pricing — UNAUTHED, flag-gated. Returns the catalog of
 * the monthly + annual Gold prices currently configured in Stripe.
 *
 * Used by:
 *   F8.17 — apps/admin /premium page
 *   F8.18 — apps/mobile Premium screen
 *
 * Both surfaces render pricing BEFORE the user signs in, so no auth
 * preHandler is attached. The route reads:
 *   STRIPE_PRICE_PREMIUM_GOLD_MONTHLY
 *   STRIPE_PRICE_PREMIUM_GOLD_ANNUAL
 * from env, fetches each Stripe Price via app.stripe.retrievePrice, parses
 * metadata.{baseAmountCents,devFeePercent} as integers, computes
 *   devFeeCents = Math.round(baseAmountCents * devFeePercent / 100)
 *   grossAmountCents = baseAmountCents + devFeeCents
 * (canon §F8.1 + canon Stripe gross formula), and returns the parsed
 * response.
 *
 * Failure modes:
 *   503 ServiceUnavailable — flag off OR env missing OR Stripe call throws
 *   500 PricingMetadataMissing — Stripe Price metadata invalid / unparseable
 */

import { premiumPricingResponseSchema } from '@jdm/shared/premium';
import type { FastifyPluginAsync } from 'fastify';

type Cadence = 'monthly' | 'annual';

const parsePositiveInt = (value: string | undefined): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const parsePercent = (value: string | undefined): number | null => {
  const parsed = parsePositiveInt(value);
  if (parsed === null) return null;
  if (parsed > 100) return null;
  return parsed;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const premiumPricingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/premium/pricing', async (request, reply) => {
    if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED) {
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'premium billing not available' });
    }

    const monthlyId = app.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY;
    const annualId = app.env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL;

    if (!monthlyId || !annualId) {
      request.log.error(
        { hasMonthly: Boolean(monthlyId), hasAnnual: Boolean(annualId) },
        'premium-pricing: STRIPE_PRICE_PREMIUM_GOLD_* env vars missing',
      );
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'billing price not configured' });
    }

    // Fetch both prices in parallel. If either throws, return 503 — the page
    // can show a retry button. We do NOT return a partial response (canon
    // "Always returns both cadences").
    let monthlyPrice;
    let annualPrice;
    try {
      [monthlyPrice, annualPrice] = await Promise.all([
        app.stripe.retrievePrice(monthlyId),
        app.stripe.retrievePrice(annualId),
      ]);
    } catch (err) {
      request.log.error({ err }, 'premium-pricing: Stripe Price retrieval failed');
      return reply
        .status(503)
        .send({ error: 'ServiceUnavailable', message: 'pricing temporarily unavailable' });
    }

    const buildEntry = (priceId: string, cadence: Cadence, price: typeof monthlyPrice) => {
      const baseAmountCents = parsePositiveInt(price.metadata?.baseAmountCents);
      const devFeePercent = parsePercent(price.metadata?.devFeePercent);
      if (baseAmountCents === null || devFeePercent === null) {
        return null;
      }
      const devFeeCents = Math.round((baseAmountCents * devFeePercent) / 100);
      const grossAmountCents = baseAmountCents + devFeeCents;
      return {
        priceId,
        cadence,
        baseAmountCents,
        devFeePercent,
        devFeeCents,
        grossAmountCents,
        currency: price.currency.toUpperCase(),
      };
    };

    const monthly = buildEntry(monthlyId, 'monthly', monthlyPrice);
    const annual = buildEntry(annualId, 'annual', annualPrice);

    if (!monthly || !annual) {
      request.log.error(
        {
          monthlyOk: Boolean(monthly),
          annualOk: Boolean(annual),
          monthlyMetadata: monthlyPrice.metadata,
          annualMetadata: annualPrice.metadata,
        },
        'premium-pricing: Stripe Price metadata missing or unparseable',
      );
      return reply.status(500).send({
        error: 'PricingMetadataMissing',
        message: 'Stripe Price metadata is missing baseAmountCents or devFeePercent',
      });
    }

    return reply.status(200).send(premiumPricingResponseSchema.parse({ monthly, annual }));
  });
};
```

- [ ] **Step 3.4 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN.

- [ ] **Step 3.5 — Run the tests (most still fail until Task 4)**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/premium-pricing.test.ts
```

If tests fail with 404, that is expected — Task 4 registers the route. If tests fail for other reasons (compile error, missing method), fix those before moving on.

---

## Task 4 — Register route in `app.ts`

**Files:**

- Modify: `apps/api/src/app.ts`

- [ ] **Step 4.1 — Add the import**

Read the existing import block in `apps/api/src/app.ts`. Add alphabetically near the other route imports (after `mePremiumRoutes`):

```ts
import { premiumPricingRoutes } from './routes/premium-pricing.js';
```

- [ ] **Step 4.2 — Register the route**

Inside `buildApp`, register the plugin. The route is unauthed and stateless, so it can register near the public-surface routes. Add right after `await app.register(mePremiumRoutes);` (or anywhere in the route-registration block — order does not matter for this route):

```ts
await app.register(premiumPricingRoutes);
```

- [ ] **Step 4.3 — Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: GREEN.

- [ ] **Step 4.4 — Run the full test suite for this chunk**

```bash
pnpm --filter @jdm/api exec vitest run test/billing/premium-pricing.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4.5 — Commit Tasks 3 + 4 together**

```bash
git add \
  apps/api/src/routes/premium-pricing.ts \
  apps/api/src/app.ts \
  apps/api/test/billing/premium-pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/premium/pricing public unauthed pricing route (F8.20)

Single Fastify plugin gated on GROWTH_PREMIUM_BILLING_ENABLED. Reads
STRIPE_PRICE_PREMIUM_GOLD_MONTHLY/ANNUAL env vars (added in F8.09), fetches
each Stripe Price via app.stripe.retrievePrice, parses metadata
baseAmountCents + devFeePercent, computes devFeeCents +
grossAmountCents per canon §F8.1, and returns the parsed catalog.

No preHandler, no requireAuth — F8.17 (web /premium) and F8.18 (mobile
Premium screen) render pricing without forcing a login first.

Failure modes:
  503 ServiceUnavailable — flag off OR env missing OR Stripe call throws
  500 PricingMetadataMissing — Stripe Price metadata invalid

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Final verification

- [ ] **Step 5.1 — Rebuild shared + run all touched tests**

Stop and fix at the first failure.

```bash
# 1. Shared
pnpm --filter @jdm/shared build
pnpm --filter @jdm/shared exec vitest run src/__tests__/premium-pricing.test.ts

# 2. API
pnpm --filter @jdm/api typecheck
pnpm --filter @jdm/api exec vitest run test/billing/stripe-retrieve-price.test.ts
pnpm --filter @jdm/api exec vitest run test/billing/premium-pricing.test.ts

# 3. Regression guard: existing me-premium tests still green
pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts
```

`pnpm --filter @jdm/shared build` is required before API tests (canon §F8.13 + `feedback_rebuild_shared_after_schema_change.md`). Per `feedback_no_full_test_suite_locally.md`, only touched test files run. Per `feedback_no_background_shells.md`, all commands are one-shot.

- [ ] **Step 5.2 — Lint touched files**

```bash
pnpm --filter @jdm/api lint:fix \
  src/routes/premium-pricing.ts \
  src/services/stripe/index.ts \
  src/services/stripe/fake.ts \
  src/app.ts \
  test/billing/premium-pricing.test.ts \
  test/billing/stripe-retrieve-price.test.ts
pnpm --filter @jdm/shared lint:fix \
  src/premium.ts \
  src/__tests__/premium-pricing.test.ts
```

Expected: clean exit codes; no fixes left to apply.

- [ ] **Step 5.3 — Commit Task 5 if any fixes were needed**

If no fixes were needed, proceed directly to Task 6.

---

## Task 6 — PR

- [ ] **Step 6.1 — Push**

```bash
git push -u origin feat/jdma-f8-billing-20
```

- [ ] **Step 6.2 — Open PR (`gh pr create --base main`)**

```bash
gh pr create --title "feat(api): GET /api/premium/pricing public pricing route (F8.20 gap #4)" --body "$(cat <<'EOF'
## Summary

- New **unauthed** `GET /api/premium/pricing` endpoint (feature-flagged per canon §F8.11 — `GROWTH_PREMIUM_BILLING_ENABLED`)
- Reads `STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` + `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL` env vars (already added in F8.09)
- Calls a new `app.stripe.retrievePrice(priceId)` helper for each, parses `Stripe.Price.metadata.baseAmountCents` + `metadata.devFeePercent` as integers, computes `devFeeCents = round(base * percent / 100)` + `grossAmountCents = base + devFeeCents` per canon §F8.1 + canon Stripe gross formula
- Returns the parsed catalog under a new `premiumPricingResponseSchema` in `@jdm/shared/premium`
- Two new shared zod schemas: `premiumPricingEntrySchema` + `premiumPricingResponseSchema`
- Closes orchestrator gap #4 — F8.17 (web /premium) + F8.18 (mobile Premium screen) can now render pricing without an auth context

## Failure modes

| Condition                                       | Status | Body                                          |
| ----------------------------------------------- | ------ | --------------------------------------------- |
| `GROWTH_PREMIUM_BILLING_ENABLED=false`          | 503    | `{ error: 'ServiceUnavailable' }`             |
| Either `STRIPE_PRICE_PREMIUM_GOLD_*` env missing | 503    | `{ error: 'ServiceUnavailable' }`             |
| `app.stripe.retrievePrice` throws               | 503    | `{ error: 'ServiceUnavailable' }`             |
| Stripe Price metadata missing keys               | 500    | `{ error: 'PricingMetadataMissing' }`         |
| Stripe Price metadata non-numeric                | 500    | `{ error: 'PricingMetadataMissing' }`         |

## Out of scope

- F8.11 extension to accept `?priceCatalog=true` — handoff sketch defers this; this PR adds a separate public route instead
- Pricing dashboard / Stripe Prices themselves — operational config (F8.19 ops task)
- F8.17 + F8.18 UI consumption — separate chunks

## Deviations from skeleton

This chunk has no skeleton entry (gap #4 was authored ad-hoc by the orchestrator after run 8). The implementation follows the patterns set by:

- F8.09 chunk for the Fastify-plugin + Stripe-mock test shape
- F8.11 chunk for the `premiumStatusSchema` + `@jdm/shared/premium` co-location

## Test plan

- [ ] `pnpm --filter @jdm/shared build` — shared compiles with new exports
- [ ] `pnpm --filter @jdm/shared exec vitest run src/__tests__/premium-pricing.test.ts` — 11 schema tests PASS
- [ ] `pnpm --filter @jdm/api typecheck` — GREEN
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/stripe-retrieve-price.test.ts` — 2 stripe-helper tests PASS
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/premium-pricing.test.ts` — 10 route tests PASS (happy path, unauthed equivalence, flag off, monthly env missing, annual env missing, metadata missing × 2, metadata non-numeric, currency casing, Stripe throw)
- [ ] `pnpm --filter @jdm/api exec vitest run test/billing/me-premium.test.ts` — regression guard PASS

## Canon refs

- §F8.1 (devfee snapshotted from Stripe Price metadata; never re-derived from env)
- §F8.11 (feature flag gate; 503 when disabled)
- §F8.12 (filtered test command form)
- §F8.13 (rebuild `@jdm/shared` after schema additions)
- Canon "Stripe gross formula: `gross = base + devFee`"
- Canon "`Number.isFinite` over `||`"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR opens against `main`. Never `production`.

---

## Cross-references

- Skeleton master index: `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` (this chunk is appended as the gap-#4 addition; not in the original index).
- Spec (canonical): `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §8.2 (web subscribe), §8.3 (shared schemas), §9 step 4 (Stripe Dashboard Price config: `baseAmountCents`, `devFeePercent` in metadata).
- Stripe service file (extend): `apps/api/src/services/stripe/index.ts`.
- Existing route pattern reference: `apps/api/src/routes/me-premium.ts` (flag-gate shape) + `apps/api/src/routes/health.ts` (unauthed plugin shape).
- Reference for Stripe metadata key names: `apps/api/src/workers/billing-reconcile.ts:79-83` + `apps/api/src/services/billing/normalize-stripe.ts:205-206` — both read `metadata.baseAmountCents` + `metadata.devFeePercent`.
- Orchestrator handoff: `.handoffs/orchestrator-state.md` "Gap #4 plan" section.

## Self-review checklist (before requesting review)

- [ ] Branch `feat/jdma-f8-billing-20`, cut from fresh `main`. F8.09 + F8.11 are on `main`.
- [ ] `packages/shared/src/premium.ts` has `premiumPricingEntrySchema` + `premiumPricingResponseSchema` exports. `pnpm --filter @jdm/shared build` produced fresh `dist/premium.js`.
- [ ] `packages/shared/package.json` was NOT modified (the `./premium` subpath was added in F8.09).
- [ ] `apps/api/src/services/stripe/index.ts` has `retrievePrice: (priceId: string) => Promise<Stripe.Price>` on the `StripeClient` type AND in the `buildStripe` return object.
- [ ] `apps/api/src/services/stripe/fake.ts` gains `nextRetrievedPrice: Stripe.Price | null` field, `'retrievePrice'` literal in the `FakeCall` union, and a `retrievePrice` impl that returns `nextRetrievedPrice` (throws when null). No existing fake fields touched.
- [ ] `apps/api/src/routes/premium-pricing.ts` has NO `preHandler: [app.authenticate]`. Anonymous callers reach the handler.
- [ ] Handler checks `app.env.GROWTH_PREMIUM_BILLING_ENABLED` first and returns 503 if false (canon §F8.11).
- [ ] Handler reads `app.env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY` + `STRIPE_PRICE_PREMIUM_GOLD_ANNUAL`; if either is absent returns 503.
- [ ] Handler wraps both `app.stripe.retrievePrice` calls in `Promise.all` inside a single `try`; on throw returns 503.
- [ ] `devFeeCents = Math.round(baseAmountCents * devFeePercent / 100)`. Integer arithmetic only.
- [ ] `grossAmountCents = baseAmountCents + devFeeCents`. NOT `base * (1 + percent / 100)` — use canon formula.
- [ ] `currency` is upper-cased on the way out (`price.currency.toUpperCase()`).
- [ ] Response is parsed through `premiumPricingResponseSchema.parse(...)` before sending.
- [ ] No PII / user-scoped data leaked. Handler does NOT read `request.user`, `request.headers.authorization`, or call any Prisma method.
- [ ] No `garageId`, `userId`, `email`, or other tenant-scoped value appears in the response.
- [ ] Tests use the F8.09 `buildPremiumApp` pattern: local `process.env` mutation + `buildFakeStripe()` + `buildApp(loadEnv(), { stripe })`, with `restoreEnv` in `afterEach` / `afterAll`. Tests that need divergent monthly/annual prices reassign `stripe.retrievePrice = vi.fn(...)`. No reliance on `vi.mock('../../src/services/stripe/index.js', ...)`.
- [ ] Test "responds identically with no auth header" PASSES — proves the route is unauthed.
- [ ] PR body lists failure-mode table.
- [ ] PR opens against `main`, never `production`.

## Reviewer audit checklist (paste into the reviewer brief)

- [ ] **`gh pr diff` + `Read` of every shipped file** — verbatim line citations required for every checklist item (no plan-code-block citations).
- [ ] `apps/api/src/services/stripe/fake.ts` edit is additive only. Confirm: (a) `'retrievePrice'` literal appended to the `FakeCall` union with a comma swap, (b) `nextRetrievedPrice: Stripe.Price | null` field added, (c) `nextRetrievedPrice: null` initialized in `buildFakeStripe`, (d) `retrievePrice` impl pushes to `calls` + returns `nextRetrievedPrice` (throws when null). NO other existing fake fields touched. Verbatim citations × 4.
- [ ] Route registered WITHOUT auth middleware. Confirm `apps/api/src/routes/premium-pricing.ts` has NO `preHandler: [app.authenticate]` anywhere. Verbatim citation required.
- [ ] Route IS flag-gated. Confirm `if (!app.env.GROWTH_PREMIUM_BILLING_ENABLED)` check + 503 fallback at the handler entry. Verbatim citation required.
- [ ] Env-missing fallback: confirm `if (!monthlyId || !annualId)` returns 503 BEFORE any Stripe call. Verbatim citation required.
- [ ] Metadata key names are `baseAmountCents` + `devFeePercent` (NOT `devFeeCents`). Verbatim citation required, plus cross-ref to `apps/api/src/workers/billing-reconcile.ts:79-83` to prove consistency.
- [ ] devFee formula is `Math.round((baseAmountCents * devFeePercent) / 100)`. Verbatim citation required.
- [ ] grossAmountCents is `baseAmountCents + devFeeCents`. Verbatim citation. NOT `base * (1 + percent / 100)`.
- [ ] Response shape is `premiumPricingResponseSchema.parse(...)` not raw spread. Verbatim citation.
- [ ] Currency is upper-cased via `.toUpperCase()`. Verbatim citation.
- [ ] No PII / no user-scoped reads: grep the handler for `request.user`, `requireUser`, `request.headers.authorization`, `prisma.`, `garageId`, `userId`. All MUST be absent. Verbatim "not found" citation.
- [ ] No partial response on failure: confirm the metadata-parse failure path returns 500 with both prices' metadata logged but no JSON body containing either entry. Verbatim citation.
- [ ] `@jdm/shared` rebuilt after schema addition — verify `packages/shared/dist/premium.js` contains the new exports (`grep -c 'premiumPricingEntrySchema' packages/shared/dist/premium.js >= 1`). Verbatim citation.
- [ ] No changes outside the file list above. Confirm `git diff --name-only main...HEAD` matches exactly these 8 files:
  - `packages/shared/src/premium.ts`
  - `packages/shared/src/__tests__/premium-pricing.test.ts`
  - `apps/api/src/services/stripe/index.ts`
  - `apps/api/src/services/stripe/fake.ts`
  - `apps/api/src/routes/premium-pricing.ts`
  - `apps/api/src/app.ts`
  - `apps/api/test/billing/premium-pricing.test.ts`
  - `apps/api/test/billing/stripe-retrieve-price.test.ts`
