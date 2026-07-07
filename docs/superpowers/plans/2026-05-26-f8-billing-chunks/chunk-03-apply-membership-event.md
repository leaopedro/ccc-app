# F8.03 — `applyMembershipEvent` Core Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `applyMembershipEvent(tx, evt)` — the single chokepoint that translates every normalized `BillingEvent` into atomic DB writes (`PremiumMembership` upsert + `PremiumMembershipInvoice` insert + `Garage` snapshot + `awardXp`), plus `applyInvoiceRefund(tx, providerInvoiceRef, refundedAmountCents)` for invoice-only status flips.

**Architecture:** Pure service functions that accept a Prisma `TransactionClient` — callers own the transaction and the `SELECT FOR UPDATE` lock (canon §F8.5 mandate). Switch on `BillingEvent.kind`. `awardXp` is called inside the activation branch with NO surrounding try/catch (canon §5 + §F8.6). The Garage snapshot follows the `max()` rule on every write path (canon §F8.3). Refund is a separate function that touches only `PremiumMembershipInvoice`, never `PremiumMembership` (canon §F8.10).

**Tech Stack:** Prisma `TransactionClient`, `@prisma/client` enums (`PremiumMembershipStatus`, `PremiumProvider`, `PremiumCadence`, `GaragePremiumTier`), `isUniqueConstraintError` from `apps/api/src/lib/prisma-errors.ts`, `awardXp` from `apps/api/src/services/garage/xp-awarder.ts`, vitest + real Postgres via Testcontainers (`makeApp`, `resetDatabase`, `createUser` from `apps/api/test/helpers.ts`).

**Branch:** `feat/jdma-f8-billing-03` from fresh `main`. NEVER branch from `production` (CLAUDE.md preflight).

---

## Required reading (before any code)

1. `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` — §3.1 flow diagram, §3.2 `BillingEvent` shape, §3.5 Garage snapshot rule, §3.6 shared XP sourceRef contract, §4.1 activation tx, §4.3 renewal, §4.4 tier change, §4.5 refund, §4.7 SAVEPOINT note; canon §F8.2–§F8.6 + §F8.10 in §13.
2. `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` — §"F8.03" section + cross-chunk canon §F8.1–§F8.16.
3. `apps/api/src/services/garage/xp-awarder.ts` — canonical pattern: 4-arg `awardXp(tx, garageId, reason, opts)` + P2002 swallow inside try/catch + NO caller try/catch contract (canon §5).
4. `apps/api/src/routes/admin/user-garage.ts` — existing admin-grant route; the `awardXp(tx, garage.id, 'premium_activation', { sourceRef: \`garage:${garage.id}\` })` call on line ~147 is the shared idempotency contract your chunk must coexist with (canon §F8.2).
5. `apps/api/test/helpers.ts` — `makeApp`, `resetDatabase`, `createUser` helper shapes.
6. `apps/api/test/garage/xp-awarder.test.ts` — test file style: `beforeEach(resetDatabase + makeApp)`, `garageId(userId)` helper, `describe` block wrapping.
7. `CLAUDE.md` — branch preflight + real-Postgres mandate + no full-suite local run.

## Dependencies (must be merged on `main` before this chunk)

- **F8.01** — `PremiumMembership`, `PremiumMembershipInvoice`, `SubscriptionWebhookEvent` tables + enums + partial unique indexes + `GROWTH_PREMIUM_BILLING_ENABLED` env var in schema.
- **F8.02** — `BillingEvent` discriminated union in `apps/api/src/services/billing/types.ts`.

If either is missing from `main`, STOP and dispatch it first.

## Corrections / invariants that apply

- **Canon §F8.3** — `max()` rule: `Garage.premiumUntil = max(existing ?? epoch, new currentPeriodEnd)`. NEVER overwrite unconditionally. Document inline at every call site.
- **Canon §F8.4** — Activation tx atomicity: all membership/invoice/snapshot/XP writes are inside the caller-provided `tx`. Ticket backfill enqueue is post-commit (out of scope for this chunk — chunk F8.06 owns it).
- **Canon §F8.5** — `SELECT FOR UPDATE` is the CALLER's responsibility (the webhook route, not this service). The service receives an already-locked `tx`. This chunk DOES assert the lock is honoured via a concurrent-activation test.
- **Canon §F8.6** — Exactly one `awardXp` call per activation tx. Integration test asserts this.
- **Canon §F8.10** — `applyInvoiceRefund` flips invoice status ONLY. Membership row untouched.
- **Phase 2 canon §5** — `awardXp` is called with NO surrounding try/catch. Any error other than P2002 rethrows so the parent tx rolls back. Callers MUST NOT wrap `awardXp` in try/catch.

---

## File structure (touched paths only)

```
apps/api/src/services/billing/apply-membership-event.ts   (new)
apps/api/test/billing/apply-membership-event.test.ts      (new)
apps/api/test/billing/premium-activation-idempotency.test.ts  (new)
```

No other files. Chunk F8.04 (Stripe webhook route) and F8.05 (RC webhook route) will import `applyMembershipEvent` from this service.

---

## Canonical code shape — `apply-membership-event.ts`

```ts
import type { Prisma } from '@prisma/client';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';
import { awardXp } from '../garage/xp-awarder.js';
import type { BillingEvent } from './types.js';

/**
 * Writes the DB side-effects of a normalized BillingEvent inside the
 * caller's transaction. The caller MUST have already issued:
 *
 *   await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`
 *
 * before calling this function (canon §F8.5). This serializes concurrent
 * webhooks for the same garage.
 *
 * canon §F8.4 — Membership upsert + Invoice insert + Garage snapshot +
 *   awardXp all happen in the same tx. Ticket backfill is post-commit
 *   (chunk F8.06).
 */
export const applyMembershipEvent = async (
  tx: Prisma.TransactionClient,
  evt: BillingEvent,
): Promise<void> => {
  switch (evt.kind) {
    case 'subscription.activated':
      return handleActivated(tx, evt);
    case 'subscription.renewed':
      return handleRenewed(tx, evt);
    case 'subscription.cancelled':
      return handleCancelled(tx, evt);
    case 'subscription.uncancelled':
      return handleUncancelled(tx, evt);
    case 'subscription.expired':
      return handleExpired(tx, evt);
    case 'subscription.past_due':
      return handlePastDue(tx, evt);
    case 'subscription.tier_changed':
      return handleTierChanged(tx, evt);
    default: {
      // Exhaustive check — TypeScript will error if BillingEvent grows a new kind
      // without a corresponding case.
      const _: never = evt;
      throw new Error(`applyMembershipEvent: unhandled kind ${(_ as BillingEvent).kind}`);
    }
  }
};

// ---------------------------------------------------------------------------
// subscription.activated
// ---------------------------------------------------------------------------

async function handleActivated(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.activated' }>,
): Promise<void> {
  const {
    garageId,
    provider,
    providerCustomerRef,
    providerSubRef,
    tier,
    cadence,
    currentPeriodStart,
    currentPeriodEnd,
    pricing,
    invoice,
  } = evt;

  // Upsert PremiumMembership — idempotent on (provider, providerSubRef).
  // P2002 on the @@unique([provider, providerSubRef]) means a replay after
  // the SubscriptionWebhookEvent dedup should have caught this; rethrow
  // so the outer transaction rolls back and surfaces the logic gap.
  const membership = await tx.premiumMembership.upsert({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    create: {
      garageId,
      provider,
      providerCustomerRef,
      providerSubRef,
      tier,
      cadence,
      status: 'active',
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      baseAmountCents: pricing.baseAmountCents,
      devFeePercent: pricing.devFeePercent,
      devFeeAmountCents: pricing.devFeeAmountCents,
      grossAmountCents: pricing.grossAmountCents,
      currency: pricing.currency,
    },
    update: {
      // Idempotent re-activation: refresh period + status in case a prior
      // expired row is being re-activated via a new sub with the same ref.
      status: 'active',
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      baseAmountCents: pricing.baseAmountCents,
      devFeePercent: pricing.devFeePercent,
      devFeeAmountCents: pricing.devFeeAmountCents,
      grossAmountCents: pricing.grossAmountCents,
      currency: pricing.currency,
    },
  });

  // Insert invoice — idempotent on (provider, providerInvoiceRef).
  // P2002 = replay; silently skip (the invoice already landed).
  try {
    await tx.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider,
        providerInvoiceRef: invoice.providerInvoiceRef,
        providerTransactionRef: invoice.providerTransactionRef ?? null,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        baseAmountCents: pricing.baseAmountCents,
        devFeePercent: pricing.devFeePercent,
        devFeeAmountCents: pricing.devFeeAmountCents,
        grossAmountCents: pricing.grossAmountCents,
        currency: pricing.currency,
        paidAt: invoice.paidAt,
        status: 'paid',
      },
    });
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
    // Replay: invoice already exists; continue to snapshot + XP.
  }

  // Garage snapshot — max() rule (canon §F8.3).
  // NEVER overwrite unconditionally — admin-grant may have extended
  // premiumUntil beyond the new sub's currentPeriodEnd.
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil = currentPeriodEnd > existingUntil ? currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: garageId },
    data: { premiumTier: tier, premiumUntil: newUntil },
  });

  // XP award — exactly one call per activation tx (canon §F8.6).
  // sourceRef 'garage:<garageId>' is the shared idempotency key across
  // admin grant and self-serve webhook (canon §F8.2). The XpEvent
  // @@unique([garageId, reason, sourceRef]) makes this one-shot-ever
  // per garage. P2002 is caught silently inside awardXp; any other error
  // rethrows. NO try/catch here — canon §5 mandates callers do not wrap.
  await awardXp(tx, garageId, 'premium_activation', {
    sourceRef: `garage:${garageId}`,
    delta: 200,
  });
}

// ---------------------------------------------------------------------------
// subscription.renewed
// ---------------------------------------------------------------------------

async function handleRenewed(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.renewed' }>,
): Promise<void> {
  const { provider, providerSubRef, currentPeriodStart, currentPeriodEnd, pricing, invoice } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: {
      status: 'active',
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      baseAmountCents: pricing.baseAmountCents,
      devFeePercent: pricing.devFeePercent,
      devFeeAmountCents: pricing.devFeeAmountCents,
      grossAmountCents: pricing.grossAmountCents,
      currency: pricing.currency,
    },
  });

  try {
    await tx.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider,
        providerInvoiceRef: invoice.providerInvoiceRef,
        providerTransactionRef: invoice.providerTransactionRef ?? null,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        baseAmountCents: pricing.baseAmountCents,
        devFeePercent: pricing.devFeePercent,
        devFeeAmountCents: pricing.devFeeAmountCents,
        grossAmountCents: pricing.grossAmountCents,
        currency: pricing.currency,
        paidAt: invoice.paidAt,
        status: 'paid',
      },
    });
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e;
  }

  // Garage snapshot — max() rule (canon §F8.3). No XP on renewal.
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil = currentPeriodEnd > existingUntil ? currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumUntil: newUntil },
  });
}

// ---------------------------------------------------------------------------
// subscription.cancelled (cancel_at_period_end=true; entitlement still valid)
// ---------------------------------------------------------------------------

async function handleCancelled(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.cancelled' }>,
): Promise<void> {
  const { provider, providerSubRef, cancelledAt } = evt;

  // Set flag + cancelledAt. No snapshot change — user remains active
  // through currentPeriodEnd (spec §3.5).
  await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'cancel_scheduled', cancelAtPeriodEnd: true, cancelledAt },
  });
}

// ---------------------------------------------------------------------------
// subscription.uncancelled (user reversed cancel before period end)
// ---------------------------------------------------------------------------

async function handleUncancelled(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.uncancelled' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'active', cancelAtPeriodEnd: false, cancelledAt: null },
  });

  // Snapshot refresh — uncancelled is treated as a re-activation of the
  // existing period. max() rule (canon §F8.3) still applies.
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil =
    membership.currentPeriodEnd > existingUntil ? membership.currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumTier: membership.tier, premiumUntil: newUntil },
  });
}

// ---------------------------------------------------------------------------
// subscription.expired
// ---------------------------------------------------------------------------

async function handleExpired(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.expired' }>,
): Promise<void> {
  const { provider, providerSubRef, cancelledAt } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'expired', cancelledAt: cancelledAt ?? null },
  });

  const garageId = membership.garageId;
  const now = new Date();

  // Conditional snapshot clear (spec §3.5):
  //   - premiumUntil must be <= now (no future-dated admin extension)
  //   - no other live membership row for this garage
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: garageId } });

  const hasActiveLiveMembership = await tx.premiumMembership.findFirst({
    where: {
      garageId,
      status: { in: ['active', 'past_due', 'cancel_scheduled'] },
      id: { not: membership.id },
    },
  });

  const premiumUntilExpired = !garage.premiumUntil || garage.premiumUntil <= now;

  if (!hasActiveLiveMembership && premiumUntilExpired) {
    await tx.garage.update({
      where: { id: garageId },
      data: { premiumTier: null, premiumUntil: null },
    });
  }
  // If admin-granted premiumUntil is in the future, leave snapshot alone —
  // the admin grant extends beyond the sub period. max() rule protects it.
}

// ---------------------------------------------------------------------------
// subscription.past_due
// ---------------------------------------------------------------------------

async function handlePastDue(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.past_due' }>,
): Promise<void> {
  const { provider, providerSubRef } = evt;

  // Status flip only. No snapshot change — Stripe's automatic dunning
  // retries ~3× over 7d. Reconciliation sweep (chunk F8.12) handles
  // eventual snapshot expiry if dunning fails (spec §3.5).
  await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: { status: 'past_due' },
  });
}

// ---------------------------------------------------------------------------
// subscription.tier_changed (cadence swap monthly↔annual in v1)
// ---------------------------------------------------------------------------

async function handleTierChanged(
  tx: Prisma.TransactionClient,
  evt: Extract<BillingEvent, { kind: 'subscription.tier_changed' }>,
): Promise<void> {
  const { provider, providerSubRef, tier, cadence, pricing } = evt;

  const membership = await tx.premiumMembership.update({
    where: { provider_providerSubRef: { provider, providerSubRef } },
    data: {
      tier,
      cadence,
      baseAmountCents: pricing.baseAmountCents,
      devFeePercent: pricing.devFeePercent,
      devFeeAmountCents: pricing.devFeeAmountCents,
      grossAmountCents: pricing.grossAmountCents,
      currency: pricing.currency,
    },
  });

  // Snapshot tier refresh — max() rule on period end still applies
  // (canon §F8.3). No XP on tier change (§4.4 — premium_activation
  // is one-shot-ever per garage).
  const garage = await tx.garage.findUniqueOrThrow({ where: { id: membership.garageId } });
  const existingUntil = garage.premiumUntil ?? new Date(0);
  const newUntil =
    membership.currentPeriodEnd > existingUntil ? membership.currentPeriodEnd : existingUntil;

  await tx.garage.update({
    where: { id: membership.garageId },
    data: { premiumTier: tier, premiumUntil: newUntil },
  });
}

// ---------------------------------------------------------------------------
// applyInvoiceRefund — invoice status only (canon §F8.10)
// ---------------------------------------------------------------------------

/**
 * Flips the matching PremiumMembershipInvoice to 'refunded' or 'partial_refund'.
 * Does NOT touch PremiumMembership or Garage snapshot (canon §F8.10).
 * Entitlement persists through currentPeriodEnd. Admin force-revoke via
 * POST /users/:id/garage/premium { tier: null } is the only mid-period revoke.
 */
export const applyInvoiceRefund = async (
  tx: Prisma.TransactionClient,
  providerInvoiceRef: string,
  refundedAmountCents: number,
): Promise<void> => {
  const invoice = await tx.premiumMembershipInvoice.findFirst({
    where: { providerInvoiceRef },
  });
  if (!invoice) return; // Unknown invoice; log at call site.

  const isFullRefund = refundedAmountCents >= invoice.grossAmountCents;

  await tx.premiumMembershipInvoice.update({
    where: { id: invoice.id },
    data: {
      refundedAt: new Date(),
      refundedAmountCents,
      status: isFullRefund ? 'refunded' : 'partial_refund',
    },
  });
};
```

---

## Task 1 — Scaffold service file (stubs that throw)

**Files:** Create `apps/api/src/services/billing/apply-membership-event.ts`.

- [ ] **1.1:** Create the file with the imports, type re-export of `BillingEvent`, and stubs for both `applyMembershipEvent(tx, evt)` and `applyInvoiceRefund(tx, providerInvoiceRef, refundedAmountCents)` that `throw new Error('not implemented')`.

```ts
import type { Prisma } from '@prisma/client';
import type { BillingEvent } from './types.js';

export const applyMembershipEvent = async (
  _tx: Prisma.TransactionClient,
  _evt: BillingEvent,
): Promise<void> => {
  throw new Error('not implemented');
};

export const applyInvoiceRefund = async (
  _tx: Prisma.TransactionClient,
  _providerInvoiceRef: string,
  _refundedAmountCents: number,
): Promise<void> => {
  throw new Error('not implemented');
};
```

- [ ] **1.2:** Run typecheck to confirm the F8.02 types resolve:

```
pnpm --filter @jdm/api typecheck
```

Expected: PASS. If `BillingEvent` is missing, F8.02 has not landed — stop.

- [ ] **1.3:** Commit: `feat(api): scaffold applyMembershipEvent service stubs (chunk F8.03)`.

---

## Task 2 — Write failing tests for `subscription.activated`

**Files:** Create `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **2.1:** Create the test file. The structure mirrors `apps/api/test/garage/xp-awarder.test.ts`. The key helper `garageId(userId)` resolves the Garage row, and `buildActivatedEvt(garageId, overrides?)` builds a minimal but valid `BillingEvent` fixture.

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyInvoiceRefund, applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const BASE_PRICING = {
  baseAmountCents: 2990,
  devFeePercent: 10,
  devFeeAmountCents: 299,
  grossAmountCents: 3289,
  currency: 'BRL',
};

const BASE_INVOICE = {
  providerInvoiceRef: 'in_test_001',
  providerTransactionRef: undefined,
  periodStart: new Date('2026-06-01'),
  periodEnd: new Date('2026-07-01'),
  paidAt: new Date('2026-06-01'),
};

const buildActivatedEvt = (
  gid: string,
  overrides: Partial<Extract<BillingEvent, { kind: 'subscription.activated' }>> = {},
): Extract<BillingEvent, { kind: 'subscription.activated' }> => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_test001',
  providerSubRef: 'sub_test001',
  garageId: gid,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date('2026-06-01'),
  currentPeriodEnd: new Date('2026-07-01'),
  pricing: BASE_PRICING,
  invoice: BASE_INVOICE,
  ...overrides,
});

describe('applyMembershipEvent', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // -- subscription.activated --

  it('activated: creates PremiumMembership + Invoice + Garage snapshot + XP', async () => {
    const { user } = await createUser({ email: 'am1@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership).not.toBeNull();
    expect(membership!.status).toBe('active');
    expect(membership!.tier).toBe('gold');
    expect(membership!.cadence).toBe('monthly');
    expect(membership!.cancelAtPeriodEnd).toBe(false);
    expect(membership!.baseAmountCents).toBe(BASE_PRICING.baseAmountCents);
    expect(membership!.devFeePercent).toBe(BASE_PRICING.devFeePercent);

    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { membershipId: membership!.id },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].providerInvoiceRef).toBe('in_test_001');
    expect(invoices[0].status).toBe('paid');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil?.toISOString()).toBe(new Date('2026-07-01').toISOString());

    const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(xpEvents).toHaveLength(1);
    expect(xpEvents[0].reason).toBe('premium_activation');
    expect(xpEvents[0].delta).toBe(200);
    expect(xpEvents[0].sourceRef).toBe(`garage:${gid}`);

    const updatedGarage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(updatedGarage.xp).toBe(200);
  });
```

- [ ] **2.2:** Run the test to confirm it fails with `not implemented`:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: FAIL with `Error: not implemented`.

- [ ] **2.3:** Implement the full service body from the canonical code shape above (entire `apply-membership-event.ts` as shown in the Canonical code shape section).

- [ ] **2.4:** Re-run the test:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: The `activated` test PASSES.

- [ ] **2.5:** Commit: `feat(api): applyMembershipEvent activated branch — membership + invoice + snapshot + XP`.

---

## Task 3 — Garage snapshot max() rule on activated

The max() rule is canon §F8.3 and must be asserted explicitly.

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **3.1:** Add test inside the `describe` block:

```ts
it('activated: max() rule — existing admin-grant premiumUntil beyond sub period is not clobbered', async () => {
  const { user } = await createUser({ email: 'am2@jdm.test', verified: true });
  const gid = await garageId(user.id);

  // Simulate admin grant pushing premiumUntil far into the future.
  const adminGrantUntil = new Date('2027-01-01');
  await prisma.garage.update({
    where: { id: gid },
    data: { premiumTier: 'gold', premiumUntil: adminGrantUntil },
  });

  const subPeriodEnd = new Date('2026-07-01'); // before the admin grant date
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(
      tx,
      buildActivatedEvt(gid, {
        currentPeriodEnd: subPeriodEnd,
      }),
    );
  });

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  // max(adminGrantUntil=2027-01-01, subPeriodEnd=2026-07-01) = adminGrantUntil
  expect(garage.premiumUntil!.toISOString()).toBe(adminGrantUntil.toISOString());
});
```

- [ ] **3.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: Both tests PASS.

- [ ] **3.3:** Commit: `test(api): assert max() snapshot rule on activated (canon §F8.3)`.

---

## Task 4 — Invoice insert idempotency on activated

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **4.1:** Add test:

```ts
it('activated: replay with same invoiceRef is idempotent — single invoice row', async () => {
  const { user } = await createUser({ email: 'am3@jdm.test', verified: true });
  const gid = await garageId(user.id);
  const evt = buildActivatedEvt(gid);

  // First activation.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });

  // Second call with same invoiceRef (replay). Must not throw or insert a second invoice.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });

  const invoices = await prisma.premiumMembershipInvoice.findMany({
    where: { providerInvoiceRef: 'in_test_001' },
  });
  expect(invoices).toHaveLength(1);
  // XP also still awarded only once.
  const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(xpEvents).toHaveLength(1);
});
```

- [ ] **4.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 3 tests PASS.

- [ ] **4.3:** Commit: `test(api): invoice insert idempotency on activated replay`.

---

## Task 5 — `subscription.renewed` branch

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **5.1:** Add the renewal test fixture builder and test:

```ts
const buildRenewedEvt = (
  providerSubRef: string,
  overrides: Partial<Extract<BillingEvent, { kind: 'subscription.renewed' }>> = {},
): Extract<BillingEvent, { kind: 'subscription.renewed' }> => ({
  kind: 'subscription.renewed',
  provider: 'stripe',
  providerSubRef,
  currentPeriodStart: new Date('2026-07-01'),
  currentPeriodEnd: new Date('2026-08-01'),
  pricing: BASE_PRICING,
  invoice: {
    ...BASE_INVOICE,
    providerInvoiceRef: 'in_test_002',
    periodStart: new Date('2026-07-01'),
    periodEnd: new Date('2026-08-01'),
  },
  ...overrides,
});

it('renewed: updates period + inserts invoice + max() snapshot — no XP', async () => {
  const { user } = await createUser({ email: 'am4@jdm.test', verified: true });
  const gid = await garageId(user.id);

  // First activate.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid));
  });

  // Renewal.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildRenewedEvt('sub_test001'));
  });

  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.currentPeriodEnd.toISOString()).toBe(new Date('2026-08-01').toISOString());

  const invoices = await prisma.premiumMembershipInvoice.findMany({
    where: { membershipId: membership!.id },
    orderBy: { createdAt: 'asc' },
  });
  expect(invoices).toHaveLength(2);

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.premiumUntil!.toISOString()).toBe(new Date('2026-08-01').toISOString());

  // No XP on renewal.
  const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(xpEvents).toHaveLength(1); // still only the activation XP
});
```

- [ ] **5.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 4 tests PASS.

- [ ] **5.3:** Commit: `test(api): renewal updates period + invoice + snapshot, no XP`.

---

## Task 6 — `subscription.cancelled` and `subscription.uncancelled`

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **6.1:** Add two tests:

```ts
it('cancelled: sets cancel_scheduled flag — no snapshot change', async () => {
  const { user } = await createUser({ email: 'am5@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid));
  });

  const garageBefore = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });

  const cancelledAt = new Date('2026-06-15');
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.cancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
      cancelledAt,
    });
  });

  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.status).toBe('cancel_scheduled');
  expect(membership!.cancelAtPeriodEnd).toBe(true);
  expect(membership!.cancelledAt?.toISOString()).toBe(cancelledAt.toISOString());

  // Snapshot must be unchanged.
  const garageAfter = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garageAfter.premiumUntil?.toISOString()).toBe(garageBefore.premiumUntil?.toISOString());
});

it('uncancelled: clears flag + refreshes snapshot', async () => {
  const { user } = await createUser({ email: 'am6@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid));
  });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.cancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
      cancelledAt: new Date('2026-06-15'),
    });
  });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.uncancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
    });
  });

  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.status).toBe('active');
  expect(membership!.cancelAtPeriodEnd).toBe(false);
  expect(membership!.cancelledAt).toBeNull();

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.premiumTier).toBe('gold');
  expect(garage.premiumUntil).not.toBeNull();
});
```

- [ ] **6.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 6 tests PASS.

- [ ] **6.3:** Commit: `test(api): cancel/uncancel transitions correct membership status + snapshot`.

---

## Task 7 — `subscription.expired` and `subscription.past_due`

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **7.1:** Add three tests (two for expired + one for past_due):

```ts
it('expired: clears Garage snapshot when premiumUntil is past and no other live membership', async () => {
  const { user } = await createUser({ email: 'am7@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(
      tx,
      buildActivatedEvt(gid, {
        currentPeriodEnd: new Date('2020-01-01'), // already in the past
      }),
    );
  });

  // Manually move premiumUntil into the past so the conditional clear fires.
  await prisma.garage.update({
    where: { id: gid },
    data: { premiumUntil: new Date('2020-01-01') },
  });

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
      cancelledAt: new Date('2020-01-01'),
    });
  });

  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.status).toBe('expired');

  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.premiumTier).toBeNull();
  expect(garage.premiumUntil).toBeNull();
});

it('expired: does NOT clear Garage snapshot when admin-grant premiumUntil is in the future', async () => {
  const { user } = await createUser({ email: 'am8@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(
      tx,
      buildActivatedEvt(gid, {
        currentPeriodEnd: new Date('2020-01-01'),
      }),
    );
  });

  // Simulate admin-grant pushing premiumUntil to the future.
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
  await prisma.garage.update({
    where: { id: gid },
    data: { premiumUntil: futureDate },
  });

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
      cancelledAt: new Date('2020-01-01'),
    });
  });

  // Snapshot must remain because admin grant extends beyond now.
  const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garage.premiumTier).toBe('gold');
  expect(garage.premiumUntil!.toISOString()).toBe(futureDate.toISOString());
});

it('past_due: flips status only — no snapshot change', async () => {
  const { user } = await createUser({ email: 'am9@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid));
  });

  const garageBefore = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.past_due',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
    });
  });

  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.status).toBe('past_due');

  const garageAfter = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(garageAfter.premiumUntil?.toISOString()).toBe(garageBefore.premiumUntil?.toISOString());
  expect(garageAfter.premiumTier).toBe(garageBefore.premiumTier);
});
```

- [ ] **7.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 9 tests PASS.

- [ ] **7.3:** Commit: `test(api): expired snapshot-clear rules + past_due status-only flip`.

---

## Task 8 — `subscription.tier_changed` and `applyInvoiceRefund`

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **8.1:** Add tests for tier_changed and refund:

```ts
it('tier_changed: updates tier/cadence/pricing snapshot — no XP', async () => {
  const { user } = await createUser({ email: 'am10@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid, { cadence: 'monthly' }));
  });

  const ANNUAL_PRICING = {
    baseAmountCents: 29900,
    devFeePercent: 10,
    devFeeAmountCents: 2990,
    grossAmountCents: 32890,
    currency: 'BRL',
  };

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, {
      kind: 'subscription.tier_changed',
      provider: 'stripe',
      providerSubRef: 'sub_test001',
      tier: 'gold',
      cadence: 'annual',
      pricing: ANNUAL_PRICING,
    });
  });

  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.cadence).toBe('annual');
  expect(membership!.grossAmountCents).toBe(ANNUAL_PRICING.grossAmountCents);

  // No additional XP — premium_activation is one-shot-ever.
  const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(xpEvents).toHaveLength(1);
});

it('applyInvoiceRefund: full refund flips invoice to refunded, membership unchanged', async () => {
  const { user } = await createUser({ email: 'am11@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid));
  });

  await prisma.$transaction(async (tx) => {
    await applyInvoiceRefund(tx, 'in_test_001', BASE_PRICING.grossAmountCents);
  });

  const invoice = await prisma.premiumMembershipInvoice.findFirst({
    where: { providerInvoiceRef: 'in_test_001' },
  });
  expect(invoice!.status).toBe('refunded');
  expect(invoice!.refundedAmountCents).toBe(BASE_PRICING.grossAmountCents);
  expect(invoice!.refundedAt).not.toBeNull();

  // Membership stays active (canon §F8.10).
  const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
  expect(membership!.status).toBe('active');
});

it('applyInvoiceRefund: partial refund sets partial_refund status', async () => {
  const { user } = await createUser({ email: 'am12@jdm.test', verified: true });
  const gid = await garageId(user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, buildActivatedEvt(gid));
  });

  await prisma.$transaction(async (tx) => {
    // Partial refund of half the gross amount.
    await applyInvoiceRefund(tx, 'in_test_001', Math.floor(BASE_PRICING.grossAmountCents / 2));
  });

  const invoice = await prisma.premiumMembershipInvoice.findFirst({
    where: { providerInvoiceRef: 'in_test_001' },
  });
  expect(invoice!.status).toBe('partial_refund');
  expect(invoice!.refundedAmountCents).toBe(Math.floor(BASE_PRICING.grossAmountCents / 2));
});
```

- [ ] **8.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 12 tests PASS.

- [ ] **8.3:** Commit: `test(api): tier_changed cadence swap + applyInvoiceRefund full/partial (canon §F8.10)`.

---

## Task 9 — Concurrent activation race (canon §F8.5 + P2002 on one-live-row index)

This is the load-bearing concurrent test. Two parallel activations for the same garage race. The `FOR UPDATE` lock (held by the caller tx) serializes them; one wins via the upsert, the other hits the `premium_membership_live_per_garage` partial unique or the `provider_providerSubRef` unique.

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **9.1:** Add the test:

```ts
it('concurrent activations for same garage: one wins, the other fails cleanly (P2002)', async () => {
  const { user } = await createUser({ email: 'am13@jdm.test', verified: true });
  const gid = await garageId(user.id);

  // Two different providerSubRefs but same garageId — this would produce two
  // live rows for the same garage, violating the partial unique index.
  const evtA = buildActivatedEvt(gid, {
    providerSubRef: 'sub_race_A',
    invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_race_A' },
  });
  const evtB = buildActivatedEvt(gid, {
    providerSubRef: 'sub_race_B',
    invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_race_B' },
  });

  const [resultA, resultB] = await Promise.allSettled([
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evtA);
    }),
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evtB);
    }),
  ]);

  // Exactly one should succeed.
  const successes = [resultA, resultB].filter((r) => r.status === 'fulfilled');
  const failures = [resultA, resultB].filter((r) => r.status === 'rejected');
  expect(successes).toHaveLength(1);
  expect(failures).toHaveLength(1);

  // Only one live membership row for this garage.
  const liveMemberships = await prisma.premiumMembership.findMany({
    where: { garageId: gid, status: { in: ['active', 'past_due', 'cancel_scheduled'] } },
  });
  expect(liveMemberships).toHaveLength(1);

  // XP awarded exactly once.
  const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
  expect(xpEvents).toHaveLength(1);
  const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
  expect(g.xp).toBe(200);
});
```

- [ ] **9.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 13 tests PASS.

- [ ] **9.3:** Commit: `test(api): concurrent activations — one wins, P2002 from live-row partial unique, XP once`.

---

## Task 10 — Single `awardXp` per activation tx assertion (canon §F8.6)

Canon §F8.6 mandates the activation tx calls `awardXp` EXACTLY ONCE. This pins the v1 invariant against future refactors that might accidentally introduce a second call.

**Files:** Modify `apps/api/test/billing/apply-membership-event.test.ts`.

- [ ] **10.1:** Add the single-awardXp guard test using a spy:

```ts
it('canon §F8.6: awardXp called exactly once per activation tx', async () => {
  const { user } = await createUser({ email: 'am14@jdm.test', verified: true });
  const gid = await garageId(user.id);

  // We spy on awardXp at the module level to count invocations.
  const awarderModule = await import('../../src/services/garage/xp-awarder.js');
  const spy = vi.spyOn(awarderModule, 'awardXp');

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(
      tx,
      buildActivatedEvt(gid, {
        providerSubRef: 'sub_spy_test',
        invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_spy_001' },
      }),
    );
  });

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(
    expect.anything(), // TransactionClient
    gid,
    'premium_activation',
    expect.objectContaining({ sourceRef: `garage:${gid}`, delta: 200 }),
  );

  spy.mockRestore();
});
```

- [ ] **10.2:** Run:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts
```

Expected: All 14 tests PASS.

- [ ] **10.3:** Commit: `test(api): spy asserts single awardXp call per activation tx (canon §F8.6)`.

---

## Task 11 — Admin-grant then webhook idempotency tests

Create the idempotency test file as specified in spec §3.6 + skeleton §F8.03.

**Files:** Create `apps/api/test/billing/premium-activation-idempotency.test.ts`.

- [ ] **11.1:** Create the file:

```ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

/**
 * These tests pin canon §F8.2: sourceRef = 'garage:<garageId>' is the shared
 * idempotency key across admin-grant (admin/user-garage.ts) and self-serve
 * webhook (apply-membership-event.ts). One-shot-ever per garage.
 */

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const makeActivatedEvt = (
  gid: string,
  providerSubRef = 'sub_idempotency_test',
  providerInvoiceRef = 'in_idempotency_001',
): Extract<BillingEvent, { kind: 'subscription.activated' }> => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_idempotency',
  providerSubRef,
  garageId: gid,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date('2026-06-01'),
  currentPeriodEnd: new Date('2026-07-01'),
  pricing: {
    baseAmountCents: 2990,
    devFeePercent: 10,
    devFeeAmountCents: 299,
    grossAmountCents: 3289,
    currency: 'BRL',
  },
  invoice: {
    providerInvoiceRef,
    providerTransactionRef: undefined,
    periodStart: new Date('2026-06-01'),
    periodEnd: new Date('2026-07-01'),
    paidAt: new Date('2026-06-01'),
  },
});

/** Helper: simulate the admin-grant path's XP award call (same sourceRef contract). */
const adminGrantXp = async (gid: string): Promise<void> => {
  const { awardXp } = await import('../../src/services/garage/xp-awarder.js');
  await prisma.$transaction((tx) =>
    awardXp(tx, gid, 'premium_activation', { sourceRef: `garage:${gid}`, delta: 200 }),
  );
};

describe('premium_activation XP idempotency — admin grant ↔ webhook (canon §F8.2)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('admin grant first, then webhook activation — XP awarded only once (200 total)', async () => {
    const { user } = await createUser({ email: 'idem1@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Admin grants premium first (simulates the admin-grant route's awardXp call).
    await adminGrantXp(gid);

    // Webhook fires.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, makeActivatedEvt(gid));
    });

    const xpEvents = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(xpEvents).toHaveLength(1); // ONE row, not two.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });

  it('webhook activation first, then admin grant — XP awarded only once (200 total)', async () => {
    const { user } = await createUser({ email: 'idem2@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Webhook fires first.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, makeActivatedEvt(gid, 'sub_idem2', 'in_idem2'));
    });

    // Admin grant runs afterward.
    await adminGrantXp(gid);

    const xpEvents = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(xpEvents).toHaveLength(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });

  it('double webhook activation with same providerSubRef — XP awarded only once', async () => {
    const { user } = await createUser({ email: 'idem3@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const evt = makeActivatedEvt(gid, 'sub_double', 'in_double_001');

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evt);
    });

    // Replay: same event, second time.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evt);
    });

    const xpEvents = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(xpEvents).toHaveLength(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });
});
```

- [ ] **11.2:** Run both test files:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts test/billing/premium-activation-idempotency.test.ts
```

Expected: All 17 tests PASS (14 + 3).

- [ ] **11.3:** Commit: `test(api): admin-grant then webhook double-XP-not-fired idempotency (canon §F8.2)`.

---

## Task 12 — Typecheck + final verification

- [ ] **12.1:** Run typecheck across the full API package:

```
pnpm --filter @jdm/api typecheck
```

Expected: PASS with no errors.

- [ ] **12.2:** Run the complete filtered test suite for this chunk:

```
pnpm --filter @jdm/api exec vitest run test/billing/apply-membership-event.test.ts test/billing/premium-activation-idempotency.test.ts
```

Expected: **17 tests pass, 0 fail.** Exact counts: 14 in `apply-membership-event.test.ts` + 3 in `premium-activation-idempotency.test.ts`.

- [ ] **12.3:** Run lint on the new files:

```
pnpm --filter @jdm/api exec eslint src/services/billing/apply-membership-event.ts test/billing/apply-membership-event.test.ts test/billing/premium-activation-idempotency.test.ts
```

Expected: PASS (no errors).

- [ ] **12.4:** Confirm git status shows exactly the 3 chunk files (plus no accidental changes to other files):

```
git status
```

Expected output (3 files, new/untracked):

```
apps/api/src/services/billing/apply-membership-event.ts
apps/api/test/billing/apply-membership-event.test.ts
apps/api/test/billing/premium-activation-idempotency.test.ts
```

Per `feedback_no_full_test_suite_locally.md`: DO NOT run the full test suite locally.

- [ ] **12.5:** Push:

```
git push -u origin feat/jdma-f8-billing-03
```

---

## PR checklist

**Branch:** `feat/jdma-f8-billing-03` from fresh `main` (NOT `production` — CLAUDE.md preflight).

**Commit subject (squash-merge title):**
`feat(api): applyMembershipEvent core service — all 7 event kinds + idempotency (chunk F8.03)`

**PR body:**

### Summary

- Lands `applyMembershipEvent(tx, evt)` at `apps/api/src/services/billing/apply-membership-event.ts`. Switches on all 7 `BillingEvent` kinds: `activated`, `renewed`, `cancelled`, `uncancelled`, `expired`, `past_due`, `tier_changed`.
- `subscription.activated` writes `PremiumMembership` (upsert) + `PremiumMembershipInvoice` (insert, P2002-idempotent) + `Garage` snapshot (max() rule, canon §F8.3) + `awardXp(tx, garageId, 'premium_activation', { sourceRef: 'garage:<id>', delta: 200 })` with NO surrounding try/catch (canon §5 + §F8.6).
- `applyInvoiceRefund(tx, providerInvoiceRef, refundedAmountCents)` flips invoice status only — membership stays active through period end (canon §F8.10).
- All writes accept a caller-owned `TransactionClient`. Caller MUST hold `SELECT FOR UPDATE` on the Garage row before calling (canon §F8.5).

### Test plan

- [x] `apply-membership-event.test.ts` (14 tests): activated happy path, max() snapshot rule, invoice replay idempotency, renewal (no XP), cancelled/uncancelled status transitions, expired conditional snapshot clear (past admin grant preserved), past_due status-only flip, tier_changed cadence swap, full + partial refund, concurrent activation P2002, single-awardXp spy (canon §F8.6).
- [x] `premium-activation-idempotency.test.ts` (3 tests): admin-grant-then-webhook, webhook-then-admin-grant, double-webhook — all yield exactly 1 XpEvent row and xp=200 (canon §F8.2).
- [x] `pnpm --filter @jdm/api typecheck` green.
- [x] No full-suite local run (per `feedback_no_full_test_suite_locally.md`).

### Deviations from plan

None — implementation matches canonical code shape verbatim.

### Canon refs

§F8.2 (shared XP sourceRef), §F8.3 (max() snapshot rule), §F8.4 (activation tx atomicity), §F8.5 (FOR UPDATE — caller responsibility), §F8.6 (single awardXp per activation tx), §F8.10 (refund honors period end). Phase 2 canon §5 (no caller try/catch on awardXp).

### Reads from / blocks

- Reads: F8.01 (schema), F8.02 (BillingEvent types).
- Blocks: F8.04 (Stripe webhook route), F8.05 (RC webhook route) — both import `applyMembershipEvent` from this service.

### Reviewer focus

1. `awardXp` call on `activated` branch has NO surrounding try/catch (canon §5). Any try/catch wrapping `awardXp` inside `handleActivated` is a bug — it would swallow non-P2002 errors and break parent tx rollback.
2. `max()` rule: `Garage.premiumUntil = max(existing ?? epoch, new currentPeriodEnd)`. Test in Task 3 pins this. Search for any unconditional `premiumUntil: currentPeriodEnd` assignment without the max comparison.
3. `expired` snapshot clear is conditional on BOTH `premiumUntil <= now` AND no other live membership row. Test in Task 7 second case pins the "admin grant preserved" rule.
4. `applyInvoiceRefund` must NOT touch `PremiumMembership.status` or `Garage.premiumTier/premiumUntil` (canon §F8.10). Search the function for any write to those fields.
5. Spy test (Task 10) asserts `awardXp` called exactly once. Future contributors adding a second `awardXp` call to `handleActivated` will see this test fail — do not remove or loosen it without a separate awarder-level multi-call fix (orchestrator deferred item #12 from Phase 2).

---

## Self-review

**Spec coverage:**

- §3.1 two-routes-one-service pattern: service implemented; routes (F8.04/05) import it. ✓
- §3.2 all 7 BillingEvent kinds: switch covers all 7 + exhaustive never check. ✓
- §3.5 Garage snapshot rules for each state: activated/renewed/uncancelled (max()), cancelled (none), expired (conditional clear), past_due (none), tier_changed (max()). All covered by tests. ✓
- §3.6 shared XP sourceRef: idempotency test file covers admin-grant-then-webhook and webhook-then-admin-grant. ✓
- §4.1 activation tx atomicity: all 5 writes inside the single tx provided by caller. ✓
- §4.3 renewal: period + invoice + max() snapshot, no XP. ✓
- §4.4 tier change: cadence swap + pricing snapshot, no XP. ✓
- §4.5 refund: `applyInvoiceRefund` flips invoice only, membership untouched. ✓
- §4.7 SAVEPOINT note: single awardXp call enforced + spy test. ✓
- Canon §F8.2, §F8.3, §F8.4, §F8.5, §F8.6, §F8.10: each has at least one explicit test. ✓

**Placeholder scan:** No TBD/TODO/handle-edge-cases language in any step. Every code block is complete. ✓

**Type consistency:** `applyMembershipEvent(tx, evt)` and `applyInvoiceRefund(tx, providerInvoiceRef, refundedAmountCents)` signatures are consistent across service file, test imports, and PR body. `BillingEvent` import path `./types.js` matches F8.02 output location. ✓

**resetDatabase coverage note:** The `resetDatabase` helper in `apps/api/test/helpers.ts` does not yet include `prisma.premiumMembership.deleteMany()` or `prisma.premiumMembershipInvoice.deleteMany()`. These tables land in F8.01. The F8.01 planner MUST add those `deleteMany` calls to `resetDatabase` as part of that chunk. If they are missing when this chunk runs, tests that share garageIds across test cases may see state bleed. This is a dependency — confirm F8.01 updated `helpers.ts` before running this chunk's tests.
