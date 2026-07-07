# Chunk 13 — Finance API: membership summary/trends/payment-mix fields

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the three existing `/finance/*` endpoints with membership-revenue fields and add a `findMembershipInvoices` query helper, so the admin financial dashboard can surface Premium Gold KPIs alongside existing ticket/store numbers.

**Architecture:** `apps/api/src/routes/admin/finance.ts` gains a new `findMembershipInvoices(where)` helper (parallel in structure to `findFinanceOrders`) and inline aggregation logic inside each of the three affected route handlers. `packages/shared/src/admin.ts` gains new zod fields on the three existing finance response schemas. The `@jdm/shared` package is rebuilt after the schema change (canon §F8.13). All tests use Testcontainers Postgres — no mocks.

**Tech Stack:** Fastify, Prisma, `@jdm/shared` zod, Vitest + Testcontainers Postgres (`makeApp` + `resetDatabase` helpers), TypeScript.

---

## Required reading before implementing

- `docs/superpowers/specs/2026-05-26-f8-premium-billing-design.md` §7.1 (API deltas), §7.3 (MRR math rounding).
- `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md` §F8.13 + cross-chunk canon §F8.1, §F8.13.
- `apps/api/src/routes/admin/finance.ts` — existing `findFinanceOrders`, `/finance/summary`, `/finance/trends`, `/finance/payment-mix` implementations (read before touching).
- `packages/shared/src/admin.ts` — existing `adminFinanceSummarySchema`, `adminFinanceTrendPointSchema`, `adminFinancePaymentMixItemSchema` (extend these three).

---

## Pre-flight checklist (run once, before Task 1)

- [ ] **Pre-flight 1: Branch safety preflight (CLAUDE.md)**

```bash
git branch --show-current
```

Expected: NOT `production`. If output is `production`, STOP. Run `git checkout main && git pull --ff-only origin main` first.

- [ ] **Pre-flight 2: Confirm upstream chunks merged**

The `PremiumMembership` and `PremiumMembershipInvoice` tables must exist in the Prisma schema (chunk F8.01 dependency).

```bash
grep -c "PremiumMembershipInvoice" packages/db/prisma/schema.prisma
```

Expected: non-zero. If zero, chunk F8.01 is not yet merged — stop.

- [ ] **Pre-flight 3: Create branch from fresh main**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/jdma-f8-billing-13
```

---

## Files touched

| Path                                                      | Action | Responsibility                                                                                              |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/admin/finance.ts`                    | Modify | Add `findMembershipInvoices` helper; extend three route handlers with membership aggregation.               |
| `packages/shared/src/admin.ts`                            | Modify | Extend `adminFinanceSummarySchema`, `adminFinanceTrendPointSchema`, `adminFinancePaymentMixItemSchema`.     |
| `apps/api/test/admin/finance-summary-memberships.test.ts` | Create | Integration tests (Testcontainers): MRR math, ARPU guard, churn count, payment-mix rows, date-window edges. |

---

## Task 1 — Write failing tests

Write all integration tests first. They target behavior that does not exist yet. Every `it` block must fail before Task 2 changes any production code.

**Files:**

- Create: `apps/api/test/admin/finance-summary-memberships.test.ts`

- [ ] **Step 1: Write the full test file**

```ts
// apps/api/test/admin/finance-summary-memberships.test.ts
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Create a PremiumMembership row and return its id. */
async function seedMembership({
  garageId,
  provider = 'stripe',
  cadence = 'monthly',
  tier = 'gold',
  status = 'active',
  grossAmountCents,
  devFeeAmountCents = 0,
  devFeePercent = 0,
  baseAmountCents,
  currentPeriodStart = new Date('2026-01-01T00:00:00Z'),
  currentPeriodEnd = new Date('2026-02-01T00:00:00Z'),
}: {
  garageId: string;
  provider?: 'stripe' | 'apple_revenuecat';
  cadence?: 'monthly' | 'annual';
  tier?: 'gold';
  status?: 'active' | 'past_due' | 'cancel_scheduled' | 'expired';
  grossAmountCents: number;
  devFeeAmountCents?: number;
  devFeePercent?: number;
  baseAmountCents?: number;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
}): Promise<string> {
  const m = await prisma.premiumMembership.create({
    data: {
      garageId,
      provider,
      providerCustomerRef: `cus_test_${Math.random().toString(36).slice(2)}`,
      providerSubRef: `sub_test_${Math.random().toString(36).slice(2)}`,
      tier,
      cadence,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      grossAmountCents,
      devFeeAmountCents,
      devFeePercent,
      baseAmountCents: baseAmountCents ?? grossAmountCents - devFeeAmountCents,
      currency: 'BRL',
    },
  });
  return m.id;
}

/** Create a PremiumMembershipInvoice row. */
async function seedInvoice({
  membershipId,
  provider = 'stripe',
  grossAmountCents,
  devFeeAmountCents = 0,
  devFeePercent = 0,
  baseAmountCents,
  status = 'paid',
  paidAt = new Date('2026-01-15T10:00:00Z'),
  refundedAmountCents,
  refundedAt,
}: {
  membershipId: string;
  provider?: 'stripe' | 'apple_revenuecat';
  grossAmountCents: number;
  devFeeAmountCents?: number;
  devFeePercent?: number;
  baseAmountCents?: number;
  status?: 'paid' | 'refunded' | 'partial_refund';
  paidAt?: Date;
  refundedAmountCents?: number;
  refundedAt?: Date;
}): Promise<void> {
  await prisma.premiumMembershipInvoice.create({
    data: {
      membershipId,
      provider,
      providerInvoiceRef: `inv_test_${Math.random().toString(36).slice(2)}`,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-02-01T00:00:00Z'),
      grossAmountCents,
      devFeeAmountCents,
      devFeePercent,
      baseAmountCents: baseAmountCents ?? grossAmountCents - devFeeAmountCents,
      currency: 'BRL',
      paidAt,
      status,
      refundedAmountCents: refundedAmountCents ?? null,
      refundedAt: refundedAt ?? null,
    },
  });
}

/** Minimal garage + user seed. Returns garageId. */
async function seedGarage(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${label}@jdm-test.local`,
      name: label,
      passwordHash: 'x',
      status: 'active',
    },
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return garage.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /finance/summary — membership fields (chunk 13)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns zero membership fields when no invoices exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    expect(body.membershipRevenueCents).toBe(0);
    expect(body.membershipNetRevenueCents).toBe(0);
    expect(body.membershipDevFeeCollectedCents).toBe(0);
    expect(body.membershipRefundedCents).toBe(0);
    expect(body.activeMembershipsCount).toBe(0);
    expect(body.newMembershipsCount).toBe(0);
    expect(body.churnedMembershipsCount).toBe(0);
    expect(body.membershipMRRCents).toBe(0);
    expect(body.membershipARPUCents).toBe(0);
  });

  it('sums membershipRevenueCents from paid invoices in the date window', async () => {
    const g1 = await seedGarage('rev1');
    const m1 = await seedMembership({ garageId: g1, grossAmountCents: 3000 });
    await seedInvoice({
      membershipId: m1,
      grossAmountCents: 3000,
      paidAt: new Date('2026-01-15T00:00:00Z'),
    });

    const g2 = await seedGarage('rev2');
    const m2 = await seedMembership({ garageId: g2, grossAmountCents: 2000 });
    // This invoice is OUTSIDE the window
    await seedInvoice({
      membershipId: m2,
      grossAmountCents: 2000,
      paidAt: new Date('2026-03-01T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary?from=2026-01-01&to=2026-01-31',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    // Only g1's invoice falls in window
    expect(body.membershipRevenueCents).toBe(3000);
  });

  it('membershipNetRevenueCents = gross minus refundedAmountCents', async () => {
    const g = await seedGarage('net1');
    const m = await seedMembership({
      garageId: g,
      grossAmountCents: 5000,
      devFeeAmountCents: 500,
      devFeePercent: 10,
    });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 5000,
      devFeeAmountCents: 500,
      devFeePercent: 10,
      paidAt: new Date('2026-01-10T00:00:00Z'),
    });
    // Partial refund invoice in same window
    const m2 = await seedMembership({ garageId: await seedGarage('net2'), grossAmountCents: 5000 });
    await seedInvoice({
      membershipId: m2,
      grossAmountCents: 5000,
      paidAt: new Date('2026-01-11T00:00:00Z'),
      status: 'partial_refund',
      refundedAmountCents: 1000,
      refundedAt: new Date('2026-01-12T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary?from=2026-01-01&to=2026-01-31',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    // gross = 5000 + 5000 = 10000; refunded = 1000
    expect(body.membershipRevenueCents).toBe(10000);
    expect(body.membershipRefundedCents).toBe(1000);
    expect(body.membershipNetRevenueCents).toBe(9000);
  });

  it('membershipDevFeeCollectedCents sums devFeeAmountCents of paid invoices in window', async () => {
    const g = await seedGarage('fee1');
    const m = await seedMembership({
      garageId: g,
      grossAmountCents: 5000,
      devFeeAmountCents: 500,
      devFeePercent: 10,
    });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 5000,
      devFeeAmountCents: 500,
      devFeePercent: 10,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipDevFeeCollectedCents).toBe(500);
  });

  it('activeMembershipsCount counts active rows (not expired, not past_due)', async () => {
    const g1 = await seedGarage('act1');
    await seedMembership({ garageId: g1, grossAmountCents: 2000, status: 'active' });
    const g2 = await seedGarage('act2');
    await seedMembership({ garageId: g2, grossAmountCents: 2000, status: 'cancel_scheduled' });
    const g3 = await seedGarage('act3');
    await seedMembership({ garageId: g3, grossAmountCents: 2000, status: 'expired' });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    // active + cancel_scheduled = 2; expired does not count
    expect(body.activeMembershipsCount).toBe(2);
  });

  it('newMembershipsCount counts PremiumMembership rows created within the date window', async () => {
    // Created in window
    const g1 = await seedGarage('new1');
    await prisma.premiumMembership.create({
      data: {
        garageId: g1,
        provider: 'stripe',
        providerCustomerRef: 'cus_new1',
        providerSubRef: 'sub_new1',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date('2026-01-05T00:00:00Z'),
        currentPeriodEnd: new Date('2026-02-05T00:00:00Z'),
        cancelAtPeriodEnd: false,
        grossAmountCents: 2000,
        devFeeAmountCents: 0,
        devFeePercent: 0,
        baseAmountCents: 2000,
        currency: 'BRL',
        createdAt: new Date('2026-01-05T00:00:00Z'),
      },
    });
    // Created OUTSIDE window
    const g2 = await seedGarage('new2');
    await prisma.premiumMembership.create({
      data: {
        garageId: g2,
        provider: 'stripe',
        providerCustomerRef: 'cus_new2',
        providerSubRef: 'sub_new2',
        tier: 'gold',
        cadence: 'monthly',
        status: 'active',
        currentPeriodStart: new Date('2025-12-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
        cancelAtPeriodEnd: false,
        grossAmountCents: 2000,
        devFeeAmountCents: 0,
        devFeePercent: 0,
        baseAmountCents: 2000,
        currency: 'BRL',
        createdAt: new Date('2025-12-01T00:00:00Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary?from=2026-01-01&to=2026-01-31',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.newMembershipsCount).toBe(1);
  });

  it('churnedMembershipsCount counts rows whose status became expired within the window', async () => {
    // Churned inside window (updatedAt as the proxy — implementation uses cancelledAt or updatedAt per spec)
    const g1 = await seedGarage('churn1');
    await prisma.premiumMembership.create({
      data: {
        garageId: g1,
        provider: 'stripe',
        providerCustomerRef: 'cus_ch1',
        providerSubRef: 'sub_ch1',
        tier: 'gold',
        cadence: 'monthly',
        status: 'expired',
        currentPeriodStart: new Date('2025-12-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-01-10T00:00:00Z'),
        cancelAtPeriodEnd: false,
        cancelledAt: new Date('2026-01-10T00:00:00Z'),
        grossAmountCents: 2000,
        devFeeAmountCents: 0,
        devFeePercent: 0,
        baseAmountCents: 2000,
        currency: 'BRL',
      },
    });
    // Expired but outside window
    const g2 = await seedGarage('churn2');
    await prisma.premiumMembership.create({
      data: {
        garageId: g2,
        provider: 'stripe',
        providerCustomerRef: 'cus_ch2',
        providerSubRef: 'sub_ch2',
        tier: 'gold',
        cadence: 'monthly',
        status: 'expired',
        currentPeriodStart: new Date('2025-10-01T00:00:00Z'),
        currentPeriodEnd: new Date('2025-11-01T00:00:00Z'),
        cancelAtPeriodEnd: false,
        cancelledAt: new Date('2025-11-01T00:00:00Z'),
        grossAmountCents: 2000,
        devFeeAmountCents: 0,
        devFeePercent: 0,
        baseAmountCents: 2000,
        currency: 'BRL',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary?from=2026-01-01&to=2026-01-31',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.churnedMembershipsCount).toBe(1);
  });

  it('MRR: monthly sub contributes grossAmountCents directly (spec §7.3)', async () => {
    const g = await seedGarage('mrr-monthly');
    await seedMembership({
      garageId: g,
      cadence: 'monthly',
      grossAmountCents: 3000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(3000);
  });

  it('MRR: annual sub contributes Math.round(grossAmountCents / 12) (spec §7.3 + canon §F8.13)', async () => {
    const g = await seedGarage('mrr-annual');
    // 36000 / 12 = 3000 exactly
    await seedMembership({
      garageId: g,
      cadence: 'annual',
      grossAmountCents: 36000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(3000);
  });

  it('MRR: annual sub rounds fractional monthly contribution', async () => {
    const g = await seedGarage('mrr-annual-round');
    // 35990 / 12 = 2999.166... → Math.round → 2999
    await seedMembership({
      garageId: g,
      cadence: 'annual',
      grossAmountCents: 35990,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(2999);
  });

  it('MRR: mixed monthly + annual sums correctly', async () => {
    const g1 = await seedGarage('mrr-mix1');
    await seedMembership({
      garageId: g1,
      cadence: 'monthly',
      grossAmountCents: 2000,
      status: 'active',
    });
    const g2 = await seedGarage('mrr-mix2');
    // 12000 / 12 = 1000
    await seedMembership({
      garageId: g2,
      cadence: 'annual',
      grossAmountCents: 12000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(3000);
  });

  it('ARPU guard: returns 0 when activeMembershipsCount is 0 (no /0 crash)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    expect(body.membershipARPUCents).toBe(0);
  });

  it('ARPU = membershipNetRevenueCents / activeMembershipsCount', async () => {
    // Two active members; net revenue = 6000 total; ARPU = 3000
    const g1 = await seedGarage('arpu1');
    const m1 = await seedMembership({ garageId: g1, grossAmountCents: 3000, status: 'active' });
    await seedInvoice({ membershipId: m1, grossAmountCents: 3000 });
    const g2 = await seedGarage('arpu2');
    const m2 = await seedMembership({ garageId: g2, grossAmountCents: 3000, status: 'active' });
    await seedInvoice({ membershipId: m2, grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/summary',
      headers: adminAuth(app),
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipARPUCents).toBe(3000);
  });
});

describe('GET /finance/trends — membershipRevenueCents per daily bucket (chunk 13)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('each trend point carries membershipRevenueCents defaulting to 0', async () => {
    const g = await seedGarage('trend1');
    // Seed a regular Order so the bucket exists (trends only emit dates that have order activity)
    // … but we specifically want to verify the membership field is present even if 0.
    // Use a membership invoice to drive the bucket instead:
    const m = await seedMembership({ garageId: g, grossAmountCents: 4000 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 4000,
      paidAt: new Date('2026-01-20T10:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/trends?from=2026-01-01&to=2026-01-31',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ points: Array<Record<string, unknown>> }>();
    const point = body.points.find((p) => p.date === '2026-01-20');
    expect(point).toBeDefined();
    expect(point!.membershipRevenueCents).toBe(4000);
  });

  it('membership invoice on day with no Order still appears as a trend point', async () => {
    const g = await seedGarage('trend2');
    const m = await seedMembership({ garageId: g, grossAmountCents: 2500 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 2500,
      paidAt: new Date('2026-02-05T08:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/trends?from=2026-02-01&to=2026-02-28',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ points: Array<Record<string, unknown>> }>();
    const point = body.points.find((p) => p.date === '2026-02-05');
    expect(point).toBeDefined();
    expect(point!.membershipRevenueCents).toBe(2500);
    // Order-derived fields default to 0 for membership-only days
    expect(point!.orderCount).toBe(0);
  });
});

describe('GET /finance/payment-mix — membership rows (chunk 13)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('includes stripe:subscription row when Stripe membership invoices exist', async () => {
    const g = await seedGarage('pmix1');
    const m = await seedMembership({ garageId: g, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/payment-mix',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    const row = body.items.find((i) => i.provider === 'stripe' && i.method === 'subscription');
    expect(row).toBeDefined();
    expect(row!.revenueCents).toBe(3000);
    expect(row!.orderCount).toBe(1);
  });

  it('includes apple_revenuecat:storekit row when RC membership invoices exist', async () => {
    const g = await seedGarage('pmix2');
    const m = await seedMembership({
      garageId: g,
      provider: 'apple_revenuecat',
      grossAmountCents: 2000,
    });
    await seedInvoice({ membershipId: m, provider: 'apple_revenuecat', grossAmountCents: 2000 });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/payment-mix',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    const row = body.items.find(
      (i) => i.provider === 'apple_revenuecat' && i.method === 'storekit',
    );
    expect(row).toBeDefined();
    expect(row!.revenueCents).toBe(2000);
  });

  it('membership rows are included in the percentage calculation', async () => {
    // 3000 Stripe subscription + 3000 Stripe card (order) = 6000 total
    // Stripe subscription should be 50%
    const g = await seedGarage('pmix3');
    const m = await seedMembership({ garageId: g, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    // Seed a regular stripe:card order
    await prisma.order.create({
      data: {
        userId: (await prisma.garage.findUniqueOrThrow({ where: { id: g } })).userId,
        amountCents: 3000,
        currency: 'BRL',
        provider: 'stripe',
        method: 'card',
        status: 'paid',
        paidAt: new Date('2026-01-15T00:00:00Z'),
        devFeeAmountCents: 0,
        kind: 'ticket',
        quantity: 1,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/finance/payment-mix',
      headers: adminAuth(app),
    });
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    const subRow = body.items.find((i) => i.provider === 'stripe' && i.method === 'subscription');
    expect(subRow).toBeDefined();
    expect(subRow!.percentage).toBe(50);
  });

  it('payment-mix omits membership rows when no membership invoices exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/finance/payment-mix',
      headers: adminAuth(app),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    expect(body.items.find((i) => i.method === 'subscription')).toBeUndefined();
    expect(body.items.find((i) => i.method === 'storekit')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and confirm all tests FAIL**

```bash
pnpm --filter @jdm/api exec vitest run test/admin/finance-summary-memberships.test.ts
```

Expected: multiple failures — the new fields (`membershipRevenueCents`, `membershipMRRCents`, etc.) are not returned yet and `stripe:subscription` / `apple_revenuecat:storekit` rows are absent from payment-mix.

- [ ] **Step 3: Commit (failing tests only)**

```bash
git add apps/api/test/admin/finance-summary-memberships.test.ts
git commit -m "test(finance): failing tests for membership summary/trends/payment-mix (chunk 13)"
```

---

## Task 2 — Extend `packages/shared/src/admin.ts` schemas

Add new fields to the three finance schemas. Do this before touching the route so TypeScript guides us.

**Files:**

- Modify: `packages/shared/src/admin.ts`

- [ ] **Step 1: Extend `adminFinanceSummarySchema`**

In `packages/shared/src/admin.ts`, locate `adminFinanceSummarySchema` (currently around line 578). Replace it with:

```ts
export const adminFinanceSummarySchema = z.object({
  totalRevenueCents: z.number().int(),
  netRevenueCents: z.number().int(),
  orderCount: z.number().int().nonnegative(),
  avgOrderCents: z.number().int().nonnegative(),
  ticketCount: z.number().int().nonnegative(),
  refundedCents: z.number().int(),
  refundedCount: z.number().int().nonnegative(),
  storeRevenueCents: z.number().int().nonnegative(),
  storeOrderCount: z.number().int().nonnegative(),
  // Current configured dev-fee percent. Reflects the env at request time, not the per-order snapshots.
  devFeePercent: z.number().int().nonnegative(),
  // Sum of Order.devFeeAmountCents on paid orders in window, minus refunded fee amounts.
  // Legacy orders snapshotted at devFeeAmountCents=0 stay zero — no retroactive imputation.
  devFeeCollectedCents: z.number().int(),
  // Membership KPIs (F8.13)
  membershipRevenueCents: z.number().int().nonnegative(),
  membershipNetRevenueCents: z.number().int(),
  membershipDevFeeCollectedCents: z.number().int().nonnegative(),
  membershipRefundedCents: z.number().int().nonnegative(),
  activeMembershipsCount: z.number().int().nonnegative(),
  newMembershipsCount: z.number().int().nonnegative(),
  churnedMembershipsCount: z.number().int().nonnegative(),
  // sum: monthly → grossAmountCents; annual → Math.round(grossAmountCents / 12) per §F8.13 / spec §7.3
  membershipMRRCents: z.number().int().nonnegative(),
  // membershipNetRevenueCents / activeMembershipsCount; guarded /0 → 0
  membershipARPUCents: z.number().int().nonnegative(),
});
export type AdminFinanceSummary = z.infer<typeof adminFinanceSummarySchema>;
```

- [ ] **Step 2: Extend `adminFinanceTrendPointSchema`**

Locate `adminFinanceTrendPointSchema` (around line 614). Replace it with:

```ts
export const adminFinanceTrendPointSchema = z.object({
  date: z.string(),
  revenueCents: z.number().int(),
  orderCount: z.number().int().nonnegative(),
  ticketRevenueCents: z.number().int().nonnegative(),
  storeRevenueCents: z.number().int().nonnegative(),
  membershipRevenueCents: z.number().int().nonnegative(),
});
export type AdminFinanceTrendPoint = z.infer<typeof adminFinanceTrendPointSchema>;
```

- [ ] **Step 3: Rebuild `@jdm/shared` (canon §F8.13)**

```bash
pnpm --filter @jdm/shared build
```

Expected: clean build, 0 errors. If TS fails, the new fields have a type mismatch — fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/admin.ts
git commit -m "feat(shared): add membership fields to finance schemas (chunk 13)"
```

---

## Task 3 — Add `findMembershipInvoices` helper to `finance.ts`

Add the new query helper parallel to `findFinanceOrders`. Does not touch any route handler yet.

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts`

- [ ] **Step 1: Add the `MembershipInvoiceWhereInput` type and `findMembershipInvoices` function**

In `apps/api/src/routes/admin/finance.ts`, after the closing brace of `findFinanceOrders` (around line 194), add:

```ts
type MembershipInvoiceWhereInput = {
  paidAtFrom?: Date;
  paidAtTo?: Date;
  status?: string;
  provider?: 'stripe' | 'apple_revenuecat';
  cadence?: 'monthly' | 'annual';
  tier?: string;
};

type MembershipInvoiceRecord = {
  id: string;
  membershipId: string;
  provider: 'stripe' | 'apple_revenuecat';
  grossAmountCents: number;
  devFeeAmountCents: number;
  devFeePercent: number;
  baseAmountCents: number;
  status: string;
  paidAt: Date;
  refundedAmountCents: number | null;
  membership: {
    cadence: 'monthly' | 'annual';
    tier: string;
    status: string;
  };
};

async function findMembershipInvoices(
  where: MembershipInvoiceWhereInput,
): Promise<MembershipInvoiceRecord[]> {
  const filters: Prisma.PremiumMembershipInvoiceWhereInput = {};

  // Default to paid invoices only
  if (where.status) {
    filters.status = where.status;
  } else {
    filters.status = { in: ['paid', 'partial_refund', 'refunded'] };
  }

  if (where.paidAtFrom || where.paidAtTo) {
    filters.paidAt = {};
    if (where.paidAtFrom) filters.paidAt.gte = where.paidAtFrom;
    if (where.paidAtTo) filters.paidAt.lte = where.paidAtTo;
  }

  if (where.provider) filters.provider = where.provider;

  if (where.cadence || where.tier) {
    filters.membership = {};
    if (where.cadence) filters.membership.cadence = where.cadence;
    if (where.tier) filters.membership.tier = where.tier as Prisma.EnumGaragePremiumTierFilter;
  }

  const invoices = await prisma.premiumMembershipInvoice.findMany({
    where: filters,
    select: {
      id: true,
      membershipId: true,
      provider: true,
      grossAmountCents: true,
      devFeeAmountCents: true,
      devFeePercent: true,
      baseAmountCents: true,
      status: true,
      paidAt: true,
      refundedAmountCents: true,
      membership: {
        select: {
          cadence: true,
          tier: true,
          status: true,
        },
      },
    },
  });

  return invoices as MembershipInvoiceRecord[];
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors. If Prisma types mismatch (e.g. `Prisma.EnumGaragePremiumTierFilter` doesn't exist for this field), adjust the cast — the field is a string enum and a plain `where.tier` assignment works.

- [ ] **Step 3: Commit (helper only — no route changes yet)**

```bash
git add apps/api/src/routes/admin/finance.ts
git commit -m "feat(finance): add findMembershipInvoices helper (chunk 13)"
```

---

## Task 4 — Extend `/finance/summary` with membership KPIs

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts` — the `GET /finance/summary` handler

- [ ] **Step 1: Build the `membershipWhere` from the query params**

Inside the `app.get('/finance/summary', ...)` handler, after `const where = buildWhere(request.query);`, add:

```ts
const q = adminFinanceQuerySchema.parse(request.query);
const membershipWhere: MembershipInvoiceWhereInput = {};
if (q.from) membershipWhere.paidAtFrom = new Date(`${q.from}T00:00:00.000Z`);
if (q.to) membershipWhere.paidAtTo = new Date(`${q.to}T23:59:59.999Z`);
if (q.provider === 'stripe') membershipWhere.provider = 'stripe';
if (q.provider === 'abacatepay') {
  /* abacatepay is not a membership provider — skip */
}
```

Note: `adminFinanceQuerySchema` is already called inside `buildWhere`, but calling it again here is safe (same input, same parse result). Alternatively, extract the parsed query from `buildWhere` — keep the simpler approach for now.

- [ ] **Step 2: Fetch membership invoices + active membership counts in parallel**

Replace:

```ts
const [orders, ticketCount] = await Promise.all([
  findFinanceOrders(where, ['paid', 'refunded']),
  prisma.ticket.count({ ... }),
]);
```

With:

```ts
const [
  orders,
  ticketCount,
  membershipInvoices,
  activeMemberships,
  newMemberships,
  churnedMemberships,
] = await Promise.all([
  findFinanceOrders(where, ['paid', 'refunded']),
  prisma.ticket.count({
    where: {
      order: where,
      status: { in: ['valid', 'used'] },
    },
  }),
  findMembershipInvoices(membershipWhere),
  prisma.premiumMembership.count({
    where: { status: { in: ['active', 'cancel_scheduled', 'past_due'] } },
  }),
  prisma.premiumMembership.count({
    where: {
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    },
  }),
  prisma.premiumMembership.count({
    where: {
      status: 'expired',
      cancelledAt: {
        ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
        ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
        not: null,
      },
    },
  }),
]);
```

- [ ] **Step 3: Aggregate membership KPIs**

After the existing `for (const order of orders) { ... }` loop (and before the `return` statement), add:

```ts
let membershipRevenueCents = 0;
let membershipRefundedCents = 0;
let membershipDevFeeCollectedCents = 0;
let membershipMRRCents = 0;

for (const inv of membershipInvoices) {
  if (inv.status === 'paid' || inv.status === 'partial_refund' || inv.status === 'refunded') {
    membershipRevenueCents += inv.grossAmountCents;
    membershipDevFeeCollectedCents += inv.devFeeAmountCents;
  }
  if (inv.refundedAmountCents != null) {
    membershipRefundedCents += inv.refundedAmountCents;
  }
}

const membershipNetRevenueCents = membershipRevenueCents - membershipRefundedCents;

// MRR: fetch active membership rows for MRR calculation (need cadence + gross).
// activeMemberships count is from PremiumMembership.count above; MRR needs the actual rows.
const activeMembershipRows = await prisma.premiumMembership.findMany({
  where: { status: { in: ['active', 'cancel_scheduled', 'past_due'] } },
  select: { cadence: true, grossAmountCents: true },
});

for (const m of activeMembershipRows) {
  if (m.cadence === 'monthly') {
    membershipMRRCents += m.grossAmountCents;
  } else {
    // annual → Math.round(grossAmountCents / 12) per spec §7.3 + canon §F8.13
    membershipMRRCents += Math.round(m.grossAmountCents / 12);
  }
}

// ARPU: guarded division — returns 0 when activeMemberships = 0 (spec §7.1)
const membershipARPUCents =
  activeMemberships > 0 ? Math.round(membershipNetRevenueCents / activeMemberships) : 0;
```

- [ ] **Step 4: Add membership fields to the return statement**

Extend the existing `return { ... }` in the `/finance/summary` handler to include:

```ts
return {
  totalRevenueCents,
  netRevenueCents,
  orderCount,
  avgOrderCents,
  ticketCount,
  refundedCents,
  refundedCount,
  storeRevenueCents,
  storeOrderCount,
  devFeePercent: app.env.DEV_FEE_PERCENT,
  devFeeCollectedCents: netDevFeeCollectedCents,
  membershipRevenueCents,
  membershipNetRevenueCents,
  membershipDevFeeCollectedCents,
  membershipRefundedCents,
  activeMembershipsCount: activeMemberships,
  newMembershipsCount: newMemberships,
  churnedMembershipsCount: churnedMemberships,
  membershipMRRCents,
  membershipARPUCents,
};
```

- [ ] **Step 5: Run summary tests**

```bash
pnpm --filter @jdm/api exec vitest run test/admin/finance-summary-memberships.test.ts -t "GET /finance/summary"
```

Expected: all summary-group tests PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts
git commit -m "feat(finance): extend /finance/summary with membership KPIs (chunk 13)"
```

---

## Task 5 — Extend `/finance/trends` with `membershipRevenueCents` per bucket

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts` — the `GET /finance/trends` handler

- [ ] **Step 1: Fetch membership invoices for the trends window**

In the `app.get('/finance/trends', ...)` handler, after `const where = buildWhere(request.query);`, add:

```ts
const tq = adminFinanceQuerySchema.parse(request.query);
const trendMembershipWhere: MembershipInvoiceWhereInput = {};
if (tq.from) trendMembershipWhere.paidAtFrom = new Date(`${tq.from}T00:00:00.000Z`);
if (tq.to) trendMembershipWhere.paidAtTo = new Date(`${tq.to}T23:59:59.999Z`);

const [orders, membershipInvoicesForTrend] = await Promise.all([
  findFinanceOrders(where, ['paid']),
  findMembershipInvoices({ ...trendMembershipWhere, status: 'paid' }),
]);
```

Replace the existing single `const orders = await findFinanceOrders(where, ['paid']);` with the `Promise.all` above.

- [ ] **Step 2: Extend the bucket type and merge membership revenue**

Replace the bucket map type from:

```ts
const buckets = new Map<
  string,
  {
    revenueCents: number;
    orderCount: number;
    ticketRevenueCents: number;
    storeRevenueCents: number;
  }
>();
```

To:

```ts
const buckets = new Map<
  string,
  {
    revenueCents: number;
    orderCount: number;
    ticketRevenueCents: number;
    storeRevenueCents: number;
    membershipRevenueCents: number;
  }
>();
```

Update the bucket initializer inside the `for (const o of orders)` loop:

```ts
const bucket = buckets.get(date) ?? {
  revenueCents: 0,
  orderCount: 0,
  ticketRevenueCents: 0,
  storeRevenueCents: 0,
  membershipRevenueCents: 0,
};
```

After the existing `for (const o of orders)` loop, add a second loop to fold membership invoices into the same buckets:

```ts
for (const inv of membershipInvoicesForTrend) {
  const date = inv.paidAt.toISOString().slice(0, 10);
  const bucket = buckets.get(date) ?? {
    revenueCents: 0,
    orderCount: 0,
    ticketRevenueCents: 0,
    storeRevenueCents: 0,
    membershipRevenueCents: 0,
  };
  bucket.membershipRevenueCents += inv.grossAmountCents;
  // Also add to revenueCents for the overall daily total
  bucket.revenueCents += inv.grossAmountCents;
  buckets.set(date, bucket);
}
```

- [ ] **Step 3: Run trends tests**

```bash
pnpm --filter @jdm/api exec vitest run test/admin/finance-summary-memberships.test.ts -t "GET /finance/trends"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts
git commit -m "feat(finance): add membershipRevenueCents to /finance/trends buckets (chunk 13)"
```

---

## Task 6 — Extend `/finance/payment-mix` with subscription rows

**Files:**

- Modify: `apps/api/src/routes/admin/finance.ts` — the `GET /finance/payment-mix` handler

- [ ] **Step 1: Fetch membership invoices alongside existing orders**

In the `app.get('/finance/payment-mix', ...)` handler, replace:

```ts
const orders = await findFinanceOrders(where, ['paid']);
```

With:

```ts
const pmq = adminFinanceQuerySchema.parse(request.query);
const pmMembershipWhere: MembershipInvoiceWhereInput = {};
if (pmq.from) pmMembershipWhere.paidAtFrom = new Date(`${pmq.from}T00:00:00.000Z`);
if (pmq.to) pmMembershipWhere.paidAtTo = new Date(`${pmq.to}T23:59:59.999Z`);

const [orders, membershipInvoicesForMix] = await Promise.all([
  findFinanceOrders(where, ['paid']),
  findMembershipInvoices({ ...pmMembershipWhere, status: 'paid' }),
]);
```

- [ ] **Step 2: Fold membership invoices into the payment-mix buckets**

The existing bucket type uses `provider: 'stripe' | 'abacatepay'` and `method: 'card' | 'pix'`. Membership rows use provider `'stripe'` or `'apple_revenuecat'`, and a synthetic `method` of `'subscription'` (Stripe) or `'storekit'` (Apple). Widen the bucket type:

Replace:

```ts
const buckets = new Map<
  string,
  {
    provider: 'stripe' | 'abacatepay';
    method: 'card' | 'pix';
    revenueCents: number;
    orderCount: number;
  }
>();
```

With:

```ts
const buckets = new Map<
  string,
  {
    provider: string;
    method: string;
    revenueCents: number;
    orderCount: number;
  }
>();
```

After the existing `for (const order of orders)` loop, add:

```ts
for (const inv of membershipInvoicesForMix) {
  const method = inv.provider === 'stripe' ? 'subscription' : 'storekit';
  const key = `${inv.provider}:${method}`;
  const bucket = buckets.get(key) ?? {
    provider: inv.provider,
    method,
    revenueCents: 0,
    orderCount: 0,
  };
  bucket.revenueCents += inv.grossAmountCents;
  bucket.orderCount += 1;
  buckets.set(key, bucket);
}
```

- [ ] **Step 3: Run payment-mix tests**

```bash
pnpm --filter @jdm/api exec vitest run test/admin/finance-summary-memberships.test.ts -t "GET /finance/payment-mix"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin/finance.ts
git commit -m "feat(finance): add stripe:subscription + apple_revenuecat:storekit to /finance/payment-mix (chunk 13)"
```

---

## Task 7 — Full verification sweep

- [ ] **Step 1: Run ALL new tests**

```bash
pnpm --filter @jdm/api exec vitest run test/admin/finance-summary-memberships.test.ts
```

Expected: all tests PASS (summary group + trends group + payment-mix group).

- [ ] **Step 2: Run the existing finance neighborhood to confirm no regression**

```bash
pnpm --filter @jdm/api exec vitest run test/admin/finance.test.ts
```

Expected: all previously-passing tests still PASS. (The handler additions are purely additive; no existing field is removed or renamed.)

- [ ] **Step 3: Rebuild @jdm/shared (canon §F8.13)**

```bash
pnpm --filter @jdm/shared build
```

Expected: clean build.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @jdm/api typecheck
```

Expected: 0 errors.

> **Do NOT run the full test suite locally** (memory rule: touched files only; CI covers the sweep).

---

## Task 8 — Open PR to `main`

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/jdma-f8-billing-13
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main \
  --title "feat(finance): membership KPIs in summary/trends/payment-mix (F8.13)" \
  --body "$(cat <<'EOF'
## Summary

- Adds `findMembershipInvoices(where)` helper to `apps/api/src/routes/admin/finance.ts`, parallel to `findFinanceOrders`. Supports filters: date range on `paidAt`, `status`, `provider`, `cadence`, `tier`.
- Extends `GET /finance/summary` with 9 new membership fields: `membershipRevenueCents`, `membershipNetRevenueCents`, `membershipDevFeeCollectedCents`, `membershipRefundedCents`, `activeMembershipsCount`, `newMembershipsCount`, `churnedMembershipsCount`, `membershipMRRCents` (monthly cadence = gross; annual cadence = `Math.round(gross/12)` per spec §7.3), `membershipARPUCents` (guarded `/0 → 0`).
- Extends `GET /finance/trends` with `membershipRevenueCents` per daily bucket. Membership-only days create new buckets.
- Extends `GET /finance/payment-mix` with `stripe:subscription` and `apple_revenuecat:storekit` rows, included in the total-revenue percentage calculation.
- Extends `packages/shared/src/admin.ts` schemas: `adminFinanceSummarySchema` + `adminFinanceTrendPointSchema` gain the new fields.
- Rebuilds `@jdm/shared` (canon §F8.13).

## Canon references

- §F8.1 — devfee storage: `devFeeAmountCents` read from snapshot, never re-derived from env.
- §F8.13 — rebuild `@jdm/shared` after schema change.
- Spec §7.1 (API deltas), §7.3 (MRR rounding).

## Test plan

- [ ] `pnpm --filter @jdm/api exec vitest run test/admin/finance-summary-memberships.test.ts` — all PASS
- [ ] `pnpm --filter @jdm/api exec vitest run test/admin/finance.test.ts` — no regression
- [ ] `pnpm --filter @jdm/shared build` — clean
- [ ] `pnpm --filter @jdm/api typecheck` — 0 errors
- [ ] CI green

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

---

## Self-review

**Spec coverage:**

- §7.1 `findMembershipInvoices` helper → Task 3.
- §7.1 `/finance/summary` nine fields → Task 4.
- §7.1 `/finance/trends` `membershipRevenueCents` → Task 5.
- §7.1 `/finance/payment-mix` two new rows → Task 6.
- §7.3 MRR math (monthly direct, annual `Math.round(/12)`) → Task 4 Step 3 + tests in Task 1.
- ARPU /0 guard → Task 4 Step 3 + test in Task 1.
- Canon §F8.1 devfee snapshot → `findMembershipInvoices` reads `devFeeAmountCents` from the invoice row, never from `app.env.DEV_FEE_PERCENT`.
- Canon §F8.13 rebuild `@jdm/shared` → Task 2 Step 3 + Task 7 Step 3.

**Placeholder scan:** No "TBD", "TODO", or "similar to Task N" entries. Every step shows the exact code.

**Type consistency:**

- `MembershipInvoiceRecord.provider` is `'stripe' | 'apple_revenuecat'` — matches `PremiumProvider` enum.
- `MembershipInvoiceRecord.membership.cadence` is `'monthly' | 'annual'` — matches `PremiumCadence`.
- `membershipMRRCents` and `membershipARPUCents` are `z.number().int().nonnegative()` — matches the aggregation logic which only sums non-negative cents and guards division.
- `adminFinanceTrendPointSchema` field `membershipRevenueCents` type matches the bucket field added in Task 5.
- Payment-mix bucket `provider` and `method` widened to `string` to accommodate the two new synthetic keys — matches the existing `adminFinancePaymentMixItemSchema` which already uses `z.string()` for both fields.

**Out of scope (this chunk):** `/finance/memberships` paginated endpoint (chunk F8.14), admin UI components (chunks F8.15–F8.16), CSV export membership columns (chunk F8.14).
