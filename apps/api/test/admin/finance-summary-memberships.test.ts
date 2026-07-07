// Chunk F8.13 — integration tests for the membership extensions of:
//   GET /admin/finance/summary
//   GET /admin/finance/trends
//   GET /admin/finance/payment-mix
//
// Every test uses Testcontainers Postgres via `makeApp` + `resetDatabase`.
// No mocks.
import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

const env = loadEnv();

function uniq(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2, 10)}`;
}

async function adminAuthHeader(label = 'admin'): Promise<{ authorization: string }> {
  const { user } = await createUser({
    email: `${uniq(label)}@jdm-test.local`,
    verified: true,
    role: 'admin',
  });
  return { authorization: bearer(env, user.id, 'admin') };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Mint a User + Garage and return the Garage id. */
async function seedGarage(label: string): Promise<string> {
  const { user } = await createUser({
    email: `${uniq(label)}@jdm-test.local`,
    name: label,
    verified: true,
    role: 'user',
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return garage.id;
}

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
  createdAt,
  cancelledAt,
}: {
  garageId: string;
  provider?: 'stripe' | 'apple_revenuecat';
  cadence?: 'monthly' | 'annual';
  tier?: 'bronze' | 'silver' | 'gold';
  status?: 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
  grossAmountCents: number;
  devFeeAmountCents?: number;
  devFeePercent?: number;
  baseAmountCents?: number;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  createdAt?: Date;
  cancelledAt?: Date;
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
      cancelledAt: cancelledAt ?? null,
      grossAmountCents,
      devFeeAmountCents,
      devFeePercent,
      baseAmountCents: baseAmountCents ?? grossAmountCents - devFeeAmountCents,
      currency: 'BRL',
      ...(createdAt ? { createdAt } : {}),
    },
  });
  return m.id;
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /admin/finance/summary — membership fields (chunk F8.13)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns zero membership fields when no invoices exist', async () => {
    const headers = await adminAuthHeader('zero');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
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
    const headers = await adminAuthHeader('rev');
    const g1 = await seedGarage('rev1');
    const m1 = await seedMembership({ garageId: g1, grossAmountCents: 3000 });
    await seedInvoice({
      membershipId: m1,
      grossAmountCents: 3000,
      paidAt: new Date('2026-01-15T00:00:00Z'),
    });

    const g2 = await seedGarage('rev2');
    const m2 = await seedMembership({ garageId: g2, grossAmountCents: 2000 });
    // Outside the window
    await seedInvoice({
      membershipId: m2,
      grossAmountCents: 2000,
      paidAt: new Date('2026-03-01T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    expect(body.membershipRevenueCents).toBe(3000);
  });

  it('membershipNetRevenueCents = gross minus refundedAmountCents', async () => {
    const headers = await adminAuthHeader('net');
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
    const m2 = await seedMembership({
      garageId: await seedGarage('net2'),
      grossAmountCents: 5000,
    });
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
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipRevenueCents).toBe(10000);
    expect(body.membershipRefundedCents).toBe(1000);
    expect(body.membershipNetRevenueCents).toBe(9000);
  });

  it('membershipDevFeeCollectedCents subtracts proportional devFee on refunded invoices', async () => {
    const headers = await adminAuthHeader('feerefund');
    const g = await seedGarage('feerefund1');
    const m = await seedMembership({
      garageId: g,
      grossAmountCents: 5000,
      devFeeAmountCents: 500,
      devFeePercent: 10,
    });
    // Invoice grossed 5000 + devFee 500; refunded 1000 (20%) → devFee
    // refunded proportional = 100. Collected = 500 - 100 = 400.
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 5000,
      devFeeAmountCents: 500,
      devFeePercent: 10,
      paidAt: new Date('2026-01-10T00:00:00Z'),
      status: 'partial_refund',
      refundedAmountCents: 1000,
      refundedAt: new Date('2026-01-12T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipDevFeeCollectedCents).toBe(400);
  });

  it('excises memberships entirely when q.provider=abacatepay (provider-leak guard)', async () => {
    const headers = await adminAuthHeader('provleak');
    const g = await seedGarage('provleak1');
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

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31&provider=abacatepay',
      headers,
    });
    const body = res.json<Record<string, number>>();
    // Membership numbers must be zero — abacatepay has no memberships.
    expect(body.membershipRevenueCents).toBe(0);
    expect(body.membershipDevFeeCollectedCents).toBe(0);
    expect(body.activeMembershipsCount).toBe(0);
    expect(body.newMembershipsCount).toBe(0);
    expect(body.churnedMembershipsCount).toBe(0);
    expect(body.membershipMRRCents).toBe(0);
  });

  it('excises memberships when q.method=pix (order-only method)', async () => {
    const headers = await adminAuthHeader('methleak');
    const g = await seedGarage('methleak1');
    const m = await seedMembership({
      garageId: g,
      grossAmountCents: 5000,
    });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 5000,
      paidAt: new Date('2026-01-10T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31&method=pix',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipRevenueCents).toBe(0);
    expect(body.activeMembershipsCount).toBe(0);
  });

  it('membershipDevFeeCollectedCents sums devFeeAmountCents of paid invoices in window', async () => {
    const headers = await adminAuthHeader('fee');
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
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipDevFeeCollectedCents).toBe(500);
  });

  it('activeMembershipsCount counts active + cancel_scheduled + past_due, not expired', async () => {
    const headers = await adminAuthHeader('act');
    const g1 = await seedGarage('act1');
    await seedMembership({ garageId: g1, grossAmountCents: 2000, status: 'active' });
    const g2 = await seedGarage('act2');
    await seedMembership({ garageId: g2, grossAmountCents: 2000, status: 'cancel_scheduled' });
    const g3 = await seedGarage('act3');
    await seedMembership({ garageId: g3, grossAmountCents: 2000, status: 'expired' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    // active + cancel_scheduled = 2; expired does not count
    expect(body.activeMembershipsCount).toBe(2);
  });

  it('newMembershipsCount counts PremiumMembership rows created within the date window', async () => {
    const headers = await adminAuthHeader('new');
    const g1 = await seedGarage('new1');
    await seedMembership({
      garageId: g1,
      grossAmountCents: 2000,
      currentPeriodStart: new Date('2026-01-05T00:00:00Z'),
      currentPeriodEnd: new Date('2026-02-05T00:00:00Z'),
      createdAt: new Date('2026-01-05T00:00:00Z'),
    });
    const g2 = await seedGarage('new2');
    await seedMembership({
      garageId: g2,
      grossAmountCents: 2000,
      currentPeriodStart: new Date('2025-12-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2025-12-01T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.newMembershipsCount).toBe(1);
  });

  it('churnedMembershipsCount counts rows with cancelledAt inside the window (gap #2 proxy)', async () => {
    const headers = await adminAuthHeader('churn');
    const g1 = await seedGarage('churn1');
    await seedMembership({
      garageId: g1,
      grossAmountCents: 2000,
      status: 'expired',
      currentPeriodStart: new Date('2025-12-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-01-10T00:00:00Z'),
      cancelledAt: new Date('2026-01-10T00:00:00Z'),
    });
    const g2 = await seedGarage('churn2');
    await seedMembership({
      garageId: g2,
      grossAmountCents: 2000,
      status: 'expired',
      currentPeriodStart: new Date('2025-10-01T00:00:00Z'),
      currentPeriodEnd: new Date('2025-11-01T00:00:00Z'),
      cancelledAt: new Date('2025-11-01T00:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?from=2026-01-01&to=2026-01-31',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.churnedMembershipsCount).toBe(1);
  });

  it('MRR: monthly sub contributes grossAmountCents directly (spec §7.3)', async () => {
    const headers = await adminAuthHeader('mrr-m');
    const g = await seedGarage('mrr-monthly');
    await seedMembership({
      garageId: g,
      cadence: 'monthly',
      grossAmountCents: 3000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(3000);
  });

  it('MRR: annual sub contributes Math.round(grossAmountCents / 12)', async () => {
    const headers = await adminAuthHeader('mrr-a');
    const g = await seedGarage('mrr-annual');
    await seedMembership({
      garageId: g,
      cadence: 'annual',
      grossAmountCents: 36000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(3000);
  });

  it('MRR: annual sub rounds fractional monthly contribution (Math.round)', async () => {
    const headers = await adminAuthHeader('mrr-ar');
    const g = await seedGarage('mrr-annual-round');
    // 35990 / 12 = 2999.166… → Math.round → 2999
    await seedMembership({
      garageId: g,
      cadence: 'annual',
      grossAmountCents: 35990,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(2999);
  });

  it('MRR: mixed monthly + annual sums correctly', async () => {
    const headers = await adminAuthHeader('mrr-mix');
    const g1 = await seedGarage('mrr-mix1');
    await seedMembership({
      garageId: g1,
      cadence: 'monthly',
      grossAmountCents: 2000,
      status: 'active',
    });
    const g2 = await seedGarage('mrr-mix2');
    await seedMembership({
      garageId: g2,
      cadence: 'annual',
      grossAmountCents: 12000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipMRRCents).toBe(3000);
  });

  it('ARPU guard: returns 0 when activeMembershipsCount is 0 (no /0 crash)', async () => {
    const headers = await adminAuthHeader('arpu-zero');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    expect(body.membershipARPUCents).toBe(0);
  });

  it('ARPU = membershipNetRevenueCents / activeMembershipsCount', async () => {
    const headers = await adminAuthHeader('arpu');
    const g1 = await seedGarage('arpu1');
    const m1 = await seedMembership({ garageId: g1, grossAmountCents: 3000, status: 'active' });
    await seedInvoice({ membershipId: m1, grossAmountCents: 3000 });
    const g2 = await seedGarage('arpu2');
    const m2 = await seedMembership({ garageId: g2, grossAmountCents: 3000, status: 'active' });
    await seedInvoice({ membershipId: m2, grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.membershipARPUCents).toBe(3000);
  });
});

describe('GET /admin/finance/trends — membershipRevenueCents per daily bucket (chunk F8.13)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('membership invoice surfaces in the matching daily bucket', async () => {
    const headers = await adminAuthHeader('trend1');
    const g = await seedGarage('trend1');
    const m = await seedMembership({ garageId: g, grossAmountCents: 4000 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 4000,
      paidAt: new Date('2026-01-20T10:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends?from=2026-01-01&to=2026-01-31',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ points: Array<Record<string, unknown>> }>();
    const point = body.points.find((p) => p.date === '2026-01-20');
    expect(point).toBeDefined();
    expect(point!.membershipRevenueCents).toBe(4000);
  });

  it('membership invoice on day with no Order still appears as a trend point', async () => {
    const headers = await adminAuthHeader('trend2');
    const g = await seedGarage('trend2');
    const m = await seedMembership({ garageId: g, grossAmountCents: 2500 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 2500,
      paidAt: new Date('2026-02-05T08:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends?from=2026-02-01&to=2026-02-28',
      headers,
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

describe('GET /admin/finance/payment-mix — membership rows (chunk F8.13)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('includes stripe:subscription row when Stripe membership invoices exist', async () => {
    const headers = await adminAuthHeader('pmix1');
    const g = await seedGarage('pmix1');
    const m = await seedMembership({ garageId: g, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    const row = body.items.find((i) => i.provider === 'stripe' && i.method === 'subscription');
    expect(row).toBeDefined();
    expect(row!.revenueCents).toBe(3000);
    expect(row!.orderCount).toBe(1);
  });

  it('includes apple_revenuecat:storekit row when RC membership invoices exist', async () => {
    const headers = await adminAuthHeader('pmix2');
    const g = await seedGarage('pmix2');
    const m = await seedMembership({
      garageId: g,
      provider: 'apple_revenuecat',
      grossAmountCents: 2000,
    });
    await seedInvoice({ membershipId: m, provider: 'apple_revenuecat', grossAmountCents: 2000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix',
      headers,
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
    const headers = await adminAuthHeader('pmix3');
    const g = await seedGarage('pmix3');
    const m = await seedMembership({ garageId: g, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    // Seed a regular stripe:card order so totals become 6000 (50/50 split)
    const userId = (await prisma.garage.findUniqueOrThrow({ where: { id: g } })).userId;
    await prisma.order.create({
      data: {
        userId,
        amountCents: 3000,
        baseAmountCents: 3000,
        devFeePercent: 0,
        devFeeAmountCents: 0,
        currency: 'BRL',
        provider: 'stripe',
        method: 'card',
        status: 'paid',
        paidAt: new Date('2026-01-15T00:00:00Z'),
        kind: 'ticket',
        quantity: 1,
        providerRef: `pi_${Math.random().toString(36).slice(2)}`,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix',
      headers,
    });
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    const subRow = body.items.find((i) => i.provider === 'stripe' && i.method === 'subscription');
    expect(subRow).toBeDefined();
    expect(subRow!.percentage).toBe(50);
  });

  it('payment-mix omits membership rows when no membership invoices exist', async () => {
    const headers = await adminAuthHeader('pmix4');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, unknown>> }>();
    expect(body.items.find((i) => i.method === 'subscription')).toBeUndefined();
    expect(body.items.find((i) => i.method === 'storekit')).toBeUndefined();
  });
});
