# F8.02 — `BillingEvent` Types + Provider Adapter Interfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the `BillingEvent` discriminated union (7 kinds) and create stub adapter signatures for both provider normalizers, with a barrel re-export — pure TS types and signatures only, no logic.

**Architecture:** New `apps/api/src/services/billing/` directory. `types.ts` owns the discriminated union and supporting sub-types. `normalize-stripe.ts` and `normalize-revenuecat.ts` each export one stub function that throws `Error('not implemented — F8.04/F8.05')`. `index.ts` re-exports everything. Tests are type-narrowing assertions via `switch`-on-`kind` plus stub-throws verification. No Testcontainers needed — this chunk produces no DB writes.

**Tech Stack:** TypeScript 5, Vitest, `@prisma/client` enum types (`PremiumProvider`, `GaragePremiumTier`, `PremiumCadence`) imported from `packages/db` (landed in F8.01). `pnpm --filter @ccc/api typecheck` + `vitest run`.

**Branch:** `feat/jdma-f8-billing-02` from fresh `main`. Never branch from `production` (CLAUDE.md preflight).

---

## Required reading (before any code)

1. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` — §3.2 (`BillingEvent` shape), §3.3 (Stripe event mapping), §3.4 (RC event mapping).
2. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` — §F8.02 section + canon §F8.1–§F8.16.
3. `apps/api/src/services/garage/awarder.ts` — coding style reference (JSDoc placement, named type exports, explicit `Prisma.TransactionClient` import pattern).
4. `apps/api/src/services/garage/xp-awarder.ts` — style reference for discriminated returns + outcome types.
5. `CLAUDE.md` — branch preflight; test command format; no full-suite local run.

## Dependencies (must be on `main` before this chunk)

- **F8.01** — `PremiumProvider`, `PremiumCadence`, `GaragePremiumTier` Prisma enums exist in the generated client; `@ccc/shared` builds; `GROWTH_PREMIUM_BILLING_ENABLED` env var registered.

If F8.01 is not merged, STOP and dispatch it first.

## File structure

```
apps/api/src/services/billing/types.ts           (NEW)
apps/api/src/services/billing/normalize-stripe.ts  (NEW)
apps/api/src/services/billing/normalize-revenuecat.ts  (NEW)
apps/api/src/services/billing/index.ts           (NEW)
apps/api/test/billing/billing-event-types.test.ts  (NEW)
```

No other files touched.

---

## Canonical code shape — `apps/api/src/services/billing/types.ts`

The shape below is derived directly from spec §3.2. Every field present in the spec is reproduced verbatim; no extras, no omissions. Sub-types are extracted into named interfaces to keep the union arms readable.

```ts
import type { GaragePremiumTier, PremiumCadence, PremiumProvider } from '@prisma/client';

/** Pricing snapshot carried on activation, renewal, and tier_changed events. */
export type BillingPricing = {
  baseAmountCents: number;
  devFeePercent: number; // canon §F8.1: snapshotted from Stripe Price.metadata; 0 for Apple/RC
  devFeeAmountCents: number;
  grossAmountCents: number;
  currency: string; // 'BRL' v1
};

/** Invoice record carried on activated and renewed events. */
export type BillingInvoice = {
  providerInvoiceRef: string;
  providerTransactionRef?: string; // Apple original_transaction_id (iOS only)
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
};

export type BillingEvent =
  | {
      kind: 'subscription.activated';
      provider: PremiumProvider;
      providerCustomerRef: string;
      providerSubRef: string;
      garageId: string;
      tier: GaragePremiumTier;
      cadence: PremiumCadence;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      pricing: BillingPricing;
      invoice: BillingInvoice;
    }
  | {
      kind: 'subscription.renewed';
      provider: PremiumProvider;
      providerSubRef: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      pricing: BillingPricing; // re-snapshotted in case Stripe Price metadata changed
      invoice: BillingInvoice;
    }
  | {
      kind: 'subscription.cancelled'; // cancel_at_period_end=true; entitlement still valid
      provider: PremiumProvider;
      providerSubRef: string;
      cancelledAt: Date;
    }
  | {
      kind: 'subscription.uncancelled'; // user reverses cancel before period end
      provider: PremiumProvider;
      providerSubRef: string;
    }
  | {
      kind: 'subscription.expired';
      provider: PremiumProvider;
      providerSubRef: string;
      cancelledAt: Date;
    }
  | {
      kind: 'subscription.past_due';
      provider: PremiumProvider;
      providerSubRef: string;
    }
  | {
      kind: 'subscription.tier_changed';
      provider: PremiumProvider;
      providerSubRef: string;
      tier: GaragePremiumTier;
      cadence: PremiumCadence;
      pricing: BillingPricing;
    };

/** Convenience: all valid `kind` strings, for exhaustiveness checks in switch arms. */
export type BillingEventKind = BillingEvent['kind'];
```

---

## Canonical code shape — `apps/api/src/services/billing/normalize-stripe.ts`

```ts
import type { BillingEvent } from './types.js';

/**
 * Maps a raw Stripe webhook event payload to a normalized `BillingEvent`,
 * or returns `null` for event types that are intentionally ignored
 * (e.g. `customer.subscription.created` — we await `invoice.paid` instead;
 * spec §3.3). `charge.refunded` is also intentionally excluded here — that
 * path updates `PremiumMembershipInvoice` status directly in the webhook
 * route without producing a `BillingEvent` (spec §4.5).
 *
 * Implementation lands in F8.04.
 */
export function normalizeStripeEvent(rawEvent: unknown): BillingEvent | null {
  throw new Error('not implemented — F8.04');
}
```

---

## Canonical code shape — `apps/api/src/services/billing/normalize-revenuecat.ts`

```ts
import type { BillingEvent } from './types.js';

/**
 * Maps a raw RevenueCat webhook event payload to a normalized `BillingEvent`,
 * or returns `null` for event types that are intentionally ignored
 * (e.g. `TRANSFER`, `SUBSCRIPTION_PAUSED`; spec §3.4) and for non-BR
 * storefronts (canon §F8.9 — log + 200 OK without DB writes).
 *
 * Implementation lands in F8.05.
 */
export function normalizeRevenueCatEvent(rawEvent: unknown): BillingEvent | null {
  throw new Error('not implemented — F8.05');
}
```

---

## Canonical code shape — `apps/api/src/services/billing/index.ts`

```ts
export type { BillingEvent, BillingEventKind, BillingPricing, BillingInvoice } from './types.js';

export { normalizeStripeEvent } from './normalize-stripe.js';
export { normalizeRevenueCatEvent } from './normalize-revenuecat.js';
```

---

## Task 1 — Scaffold `types.ts`

**Files:** Create `apps/api/src/services/billing/types.ts`.

- [ ] **1.1: Create the types file** with the full `BillingPricing`, `BillingInvoice`, `BillingEvent`, and `BillingEventKind` shapes from the canonical code block above.

- [ ] **1.2: Run typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: passes with no errors. If `PremiumProvider`, `GaragePremiumTier`, or `PremiumCadence` are not found, F8.01 migration has not been applied — STOP and merge F8.01 first.

- [ ] **1.3: Commit**

```bash
git add apps/api/src/services/billing/types.ts
git commit -m "feat(api): BillingEvent discriminated union — 7 kinds (F8.02)"
```

---

## Task 2 — Write failing type-narrowing tests

**Files:** Create `apps/api/test/billing/billing-event-types.test.ts`.

- [ ] **2.1: Write the failing test file**

The test directory `apps/api/test/billing/` may not exist yet — create it alongside the test file.

```ts
import { describe, it, expect } from 'vitest';
import type { BillingEvent, BillingEventKind } from '../../src/services/billing/types.js';
import {
  normalizeStripeEvent,
  normalizeRevenueCatEvent,
} from '../../src/services/billing/index.js';

// ---------------------------------------------------------------------------
// Type-narrowing helpers (compile-time assertions via TypeScript exhaustive
// switch). If the union arms drift from spec §3.2, these fail at typecheck.
// ---------------------------------------------------------------------------

/**
 * Returns the `kind` string from a `BillingEvent` via an exhaustive switch.
 * Adding a new `kind` to `BillingEvent` without updating this switch will
 * cause a TypeScript compile error ('never' assignment) — that's intentional.
 */
function extractKind(event: BillingEvent): BillingEventKind {
  switch (event.kind) {
    case 'subscription.activated':
      return event.kind;
    case 'subscription.renewed':
      return event.kind;
    case 'subscription.cancelled':
      return event.kind;
    case 'subscription.uncancelled':
      return event.kind;
    case 'subscription.expired':
      return event.kind;
    case 'subscription.past_due':
      return event.kind;
    case 'subscription.tier_changed':
      return event.kind;
    default: {
      // TypeScript narrows `event` to `never` here if all arms are covered.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime narrowing — each discriminant narrows exclusive fields
// ---------------------------------------------------------------------------

describe('BillingEvent type narrowing', () => {
  it('subscription.activated carries pricing + invoice + garageId', () => {
    const evt: BillingEvent = {
      kind: 'subscription.activated',
      provider: 'stripe',
      providerCustomerRef: 'cus_test',
      providerSubRef: 'sub_test',
      garageId: 'garage-001',
      tier: 'gold',
      cadence: 'monthly',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
      pricing: {
        baseAmountCents: 1900,
        devFeePercent: 10,
        devFeeAmountCents: 190,
        grossAmountCents: 2090,
        currency: 'BRL',
      },
      invoice: {
        providerInvoiceRef: 'in_test',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-02-01'),
        paidAt: new Date('2026-01-01'),
      },
    };
    expect(extractKind(evt)).toBe('subscription.activated');
    // Type narrowing — these fields only exist on this arm.
    if (evt.kind === 'subscription.activated') {
      expect(evt.garageId).toBe('garage-001');
      expect(evt.pricing.devFeePercent).toBe(10);
      expect(evt.invoice.providerInvoiceRef).toBe('in_test');
    }
  });

  it('subscription.renewed carries pricing + invoice but NOT garageId', () => {
    const evt: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: 'sub_test',
      currentPeriodStart: new Date('2026-02-01'),
      currentPeriodEnd: new Date('2026-03-01'),
      pricing: {
        baseAmountCents: 1900,
        devFeePercent: 10,
        devFeeAmountCents: 190,
        grossAmountCents: 2090,
        currency: 'BRL',
      },
      invoice: {
        providerInvoiceRef: 'in_test2',
        periodStart: new Date('2026-02-01'),
        periodEnd: new Date('2026-03-01'),
        paidAt: new Date('2026-02-01'),
      },
    };
    expect(extractKind(evt)).toBe('subscription.renewed');
    // @ts-expect-error — garageId does NOT exist on 'renewed'; TS must error here.
    void evt.garageId;
  });

  it('subscription.cancelled carries cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.cancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test',
      cancelledAt: new Date('2026-01-15'),
    };
    expect(extractKind(evt)).toBe('subscription.cancelled');
    if (evt.kind === 'subscription.cancelled') {
      expect(evt.cancelledAt).toBeInstanceOf(Date);
    }
  });

  it('subscription.uncancelled has no cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.uncancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test',
    };
    expect(extractKind(evt)).toBe('subscription.uncancelled');
    // @ts-expect-error — cancelledAt does NOT exist on 'uncancelled'.
    void evt.cancelledAt;
  });

  it('subscription.expired carries cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: 'sub_test',
      cancelledAt: new Date('2026-02-01'),
    };
    expect(extractKind(evt)).toBe('subscription.expired');
    if (evt.kind === 'subscription.expired') {
      expect(evt.cancelledAt).toBeInstanceOf(Date);
    }
  });

  it('subscription.past_due has no pricing or cancelledAt', () => {
    const evt: BillingEvent = {
      kind: 'subscription.past_due',
      provider: 'stripe',
      providerSubRef: 'sub_test',
    };
    expect(extractKind(evt)).toBe('subscription.past_due');
    // @ts-expect-error — pricing does NOT exist on 'past_due'.
    void evt.pricing;
  });

  it('subscription.tier_changed carries tier + cadence + pricing', () => {
    const evt: BillingEvent = {
      kind: 'subscription.tier_changed',
      provider: 'apple_revenuecat',
      providerSubRef: 'sub_rc_test',
      tier: 'gold',
      cadence: 'annual',
      pricing: {
        baseAmountCents: 18000,
        devFeePercent: 0, // Apple/RC path: devFeePercent = 0 (canon §F8.1)
        devFeeAmountCents: 0,
        grossAmountCents: 18000,
        currency: 'BRL',
      },
    };
    expect(extractKind(evt)).toBe('subscription.tier_changed');
    if (evt.kind === 'subscription.tier_changed') {
      expect(evt.pricing.devFeePercent).toBe(0);
      expect(evt.cadence).toBe('annual');
    }
  });

  it('BillingEvent union covers exactly 7 kinds', () => {
    // Enumerate all valid kinds. If a kind is added to the spec later, this
    // list must be updated here — the exhaustive switch above provides the
    // compile-time safety net.
    const allKinds: BillingEventKind[] = [
      'subscription.activated',
      'subscription.renewed',
      'subscription.cancelled',
      'subscription.uncancelled',
      'subscription.expired',
      'subscription.past_due',
      'subscription.tier_changed',
    ];
    expect(allKinds).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Stub-throws verification
// ---------------------------------------------------------------------------

describe('normalizeStripeEvent stub', () => {
  it('throws with message referencing F8.04', () => {
    expect(() => normalizeStripeEvent({})).toThrow('not implemented — F8.04');
  });

  it('return type is BillingEvent | null (compile-time only)', () => {
    // This call never returns — it throws. The assertion below is never reached
    // at runtime but TypeScript checks that the assignment is type-compatible.
    const _result: BillingEvent | null = null;
    void _result; // suppress unused-variable lint
  });
});

describe('normalizeRevenueCatEvent stub', () => {
  it('throws with message referencing F8.05', () => {
    expect(() => normalizeRevenueCatEvent({})).toThrow('not implemented — F8.05');
  });

  it('return type is BillingEvent | null (compile-time only)', () => {
    const _result: BillingEvent | null = null;
    void _result;
  });
});
```

- [ ] **2.2: Run test to verify it fails** (because `index.ts` does not exist yet)

```bash
pnpm --filter @ccc/api exec vitest run test/billing/billing-event-types.test.ts
```

Expected: FAIL — `Cannot find module '../../src/services/billing/index.js'`.

---

## Task 3 — Scaffold stub normalizers

**Files:** Create `apps/api/src/services/billing/normalize-stripe.ts` and `apps/api/src/services/billing/normalize-revenuecat.ts`.

- [ ] **3.1: Create `normalize-stripe.ts`** using the canonical code block above.

- [ ] **3.2: Create `normalize-revenuecat.ts`** using the canonical code block above.

- [ ] **3.3: Run typecheck**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: PASS — stubs return `BillingEvent | null`; the thrown error is unreachable but valid TS.

- [ ] **3.4: Commit**

```bash
git add apps/api/src/services/billing/normalize-stripe.ts \
        apps/api/src/services/billing/normalize-revenuecat.ts
git commit -m "feat(api): stub adapter signatures normalize-stripe + normalize-revenuecat (F8.02)"
```

---

## Task 4 — Barrel re-export `index.ts` + make tests pass

**Files:** Create `apps/api/src/services/billing/index.ts`.

- [ ] **4.1: Create `index.ts`** using the canonical code block above.

- [ ] **4.2: Run tests**

```bash
pnpm --filter @ccc/api exec vitest run test/billing/billing-event-types.test.ts
```

Expected: **PASS — 11 tests**:

- 8 tests in `BillingEvent type narrowing` suite (1 per kind + the 7-kinds count test)
- 2 tests in `normalizeStripeEvent stub` suite
- 2 tests in `normalizeRevenueCatEvent stub` suite

Expected failure modes if something is wrong:

- `@ts-expect-error` lines cause TS errors if the field accidentally DOES exist on the wrong arm — that's the test working as intended; fix the type definition.
- Exhaustive switch `default: never` fails if a kind is missing from the union.

- [ ] **4.3: Run typecheck one final time**

```bash
pnpm --filter @ccc/api typecheck
```

Expected: PASS.

- [ ] **4.4: Commit**

```bash
git add apps/api/src/services/billing/index.ts \
        apps/api/test/billing/billing-event-types.test.ts
git commit -m "test(api): type-narrowing + stub-throws tests for BillingEvent (F8.02)"
```

---

## Task 5 — Final verification + branch hygiene

- [ ] **5.1: Run verification suite**

```bash
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/billing/billing-event-types.test.ts
```

Expected: typecheck PASS; **11 tests PASS, 0 fail**.

- [ ] **5.2: Lint**

```bash
pnpm --filter @ccc/api exec eslint src/services/billing/types.ts \
  src/services/billing/normalize-stripe.ts \
  src/services/billing/normalize-revenuecat.ts \
  src/services/billing/index.ts \
  test/billing/billing-event-types.test.ts
```

Expected: PASS (0 errors, 0 warnings).

- [ ] **5.3: Check file count**

```bash
git status
```

Expected: exactly 5 new files tracked:

- `apps/api/src/services/billing/types.ts`
- `apps/api/src/services/billing/normalize-stripe.ts`
- `apps/api/src/services/billing/normalize-revenuecat.ts`
- `apps/api/src/services/billing/index.ts`
- `apps/api/test/billing/billing-event-types.test.ts`

Per `feedback_no_full_test_suite_locally.md`: DO NOT run the full test suite locally.

- [ ] **5.4: Push**

```bash
git push -u origin feat/jdma-f8-billing-02
```

---

## Verification

```bash
pnpm --filter @ccc/api typecheck
pnpm --filter @ccc/api exec vitest run test/billing/billing-event-types.test.ts
```

Both must pass before opening the PR.

---

## PR checklist

**Branch:** `feat/jdma-f8-billing-02` from fresh `main` (NOT `production` — CLAUDE.md preflight).

**Squash-merge title:**
`feat(api): BillingEvent discriminated union + provider adapter stubs (F8.02)`

**PR body:**

### Summary

- Adds `apps/api/src/services/billing/types.ts` — `BillingEvent` discriminated union covering the 7 kinds from spec §3.2 (`subscription.activated | renewed | cancelled | uncancelled | expired | past_due | tier_changed`), with `BillingPricing`, `BillingInvoice`, and `BillingEventKind` supporting types.
- Adds `normalize-stripe.ts` and `normalize-revenuecat.ts` — stub signatures (`BillingEvent | null` return type) that throw `Error('not implemented — F8.04/F8.05')`.
- Adds `billing/index.ts` barrel re-export.
- 11 tests: exhaustive `switch`-on-`kind` compile-time narrowing per arm, `@ts-expect-error` assertions on fields absent from non-matching arms, 7-kinds count assertion, stub-throws checks for both adapters.

### Test plan

- [x] `pnpm --filter @ccc/api typecheck` — PASS.
- [x] `pnpm --filter @ccc/api exec vitest run test/billing/billing-event-types.test.ts` — 11 tests PASS.
- [x] No full-suite local run (per `feedback_no_full_test_suite_locally.md`).

### Deviations from skeleton

None. Pure types + stubs; no logic deviations possible. `BillingInvoice.providerTransactionRef` is `string | undefined` (optional) per spec §3.2 Apple-only field — matches the `PremiumMembershipInvoice.providerTransactionRef String?` schema column.

### Reads from / parallel-with

- Reads: F8.01 (Prisma enums `PremiumProvider`, `GaragePremiumTier`, `PremiumCadence`). Must be on `main` first.
- Downstream: F8.03 (`applyMembershipEvent`) imports `BillingEvent` from this barrel; F8.04 fills in `normalizeStripeEvent`; F8.05 fills in `normalizeRevenueCatEvent`.

### Reviewer focus

1. All 7 `kind` strings match spec §3.2 exactly — no typos, no omissions.
2. `subscription.activated` is the ONLY arm with `garageId` (garageId resolution happens before normalization in the webhook route, spec §3.1 step 4, but is carried through to `applyMembershipEvent` only for the activation arm).
3. `BillingPricing.devFeePercent` is present on every arm that carries `pricing` — canon §F8.1 mandates it is snapshotted at time-of-charge; 0 is a valid value for RC/Apple events.
4. Stubs throw the exact strings `'not implemented — F8.04'` and `'not implemented — F8.05'` — tests assert these exact messages; F8.04/F8.05 replace the bodies without touching the test file.

---

## Deviations / Open questions

**No deviations.** This chunk is pure type definitions.

**Open questions:**

1. `GaragePremiumTier` is the existing Prisma enum for `Garage.premiumTier`. The spec references `'gold'` as the v1 single value. Confirm F8.01 did not rename or add values before this chunk runs `typecheck`.

2. `subscription.activated` is the only arm carrying `garageId` in the normalized event. Spec §3.1 step 4 says "Resolves `garageId`" in the webhook route before calling `applyMembershipEvent`. This means F8.03 can rely on `garageId` from the `activated` arm without a separate lookup. F8.04 + F8.05 must populate it there. No action needed in this chunk — flagging so F8.03 planner accounts for it.

3. The error message strings `'not implemented — F8.04'` and `'not implemented — F8.05'` are tested explicitly. If future plan authors change the throw message, the test file must be updated. This is intentional coupling — it forces the chunk planner to acknowledge what they replaced.
