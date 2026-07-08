// Chunk F8.15 fix-up — integration tests for the `kind` / `membershipStatus` /
// `cadence` / `tier` query params on /admin/finance/summary, /trends, /payment-mix.
//
// External review flagged that those keys were silently ignored. These tests
// drive the handler extensions: real Testcontainers Postgres, no mocks.
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

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
  createdAt,
}: {
  garageId: string;
  provider?: 'stripe' | 'apple_revenuecat';
  cadence?: 'monthly' | 'annual';
  tier?: 'bronze' | 'silver' | 'gold';
  status?: 'trialing' | 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused';
  grossAmountCents: number;
  createdAt?: Date;
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
      currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      grossAmountCents,
      devFeeAmountCents: 0,
      devFeePercent: 0,
      baseAmountCents: grossAmountCents,
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
  paidAt = new Date('2026-01-15T10:00:00Z'),
}: {
  membershipId: string;
  provider?: 'stripe' | 'apple_revenuecat';
  grossAmountCents: number;
  paidAt?: Date;
}): Promise<void> {
  await prisma.premiumMembershipInvoice.create({
    data: {
      membershipId,
      provider,
      providerInvoiceRef: `inv_test_${Math.random().toString(36).slice(2)}`,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-02-01T00:00:00Z'),
      grossAmountCents,
      devFeeAmountCents: 0,
      devFeePercent: 0,
      baseAmountCents: grossAmountCents,
      currency: 'BRL',
      paidAt,
      status: 'paid',
    },
  });
}

async function seedTicketOrder({
  garageId,
  amountCents,
  paidAt = new Date('2026-01-15T10:00:00Z'),
  provider = 'stripe',
  method = 'card',
}: {
  garageId: string;
  amountCents: number;
  paidAt?: Date;
  provider?: 'stripe' | 'abacatepay';
  method?: 'card' | 'pix';
}): Promise<string> {
  const userId = (await prisma.garage.findUniqueOrThrow({ where: { id: garageId } })).userId;
  const order = await prisma.order.create({
    data: {
      userId,
      amountCents,
      baseAmountCents: amountCents,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      currency: 'BRL',
      provider,
      method,
      status: 'paid',
      paidAt,
      kind: 'ticket',
      quantity: 1,
      providerRef: `pi_${Math.random().toString(36).slice(2)}`,
    },
  });
  return order.id;
}

// ---------------------------------------------------------------------------
// /finance/summary — kind filter
// ---------------------------------------------------------------------------

describe('GET /admin/finance/summary — kind filter (F8.15 fix-up)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('kind=membership zeros out ticket totals and keeps membership numbers', async () => {
    const headers = await adminAuthHeader('km1');
    const g1 = await seedGarage('km1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('km2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?kind=membership',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    // Order-side fields zeroed when kind=membership.
    expect(body.totalRevenueCents).toBe(0);
    expect(body.orderCount).toBe(0);
    expect(body.storeRevenueCents).toBe(0);
    expect(body.storeOrderCount).toBe(0);
    expect(body.ticketCount).toBe(0);
    // Membership numbers preserved.
    expect(body.membershipRevenueCents).toBe(3000);
    expect(body.activeMembershipsCount).toBe(1);
  });

  it('kind=tickets zeros out membership totals and keeps order numbers', async () => {
    const headers = await adminAuthHeader('kt1');
    const g1 = await seedGarage('kt1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('kt2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?kind=tickets',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    expect(body.totalRevenueCents).toBe(5000);
    expect(body.orderCount).toBe(1);
    expect(body.membershipRevenueCents).toBe(0);
    expect(body.activeMembershipsCount).toBe(0);
  });

  it('kind=all preserves existing behavior (orders + membership both surface)', async () => {
    const headers = await adminAuthHeader('ka1');
    const g1 = await seedGarage('ka1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('ka2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?kind=all',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, number>>();
    expect(body.totalRevenueCents).toBe(5000);
    expect(body.membershipRevenueCents).toBe(3000);
    expect(body.activeMembershipsCount).toBe(1);
  });

  it('undefined kind preserves existing behavior (regression guard)', async () => {
    const headers = await adminAuthHeader('ku1');
    const g1 = await seedGarage('ku1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('ku2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.totalRevenueCents).toBe(5000);
    expect(body.membershipRevenueCents).toBe(3000);
  });

  it('kind=membership + membershipStatus=active narrows the active count', async () => {
    const headers = await adminAuthHeader('ms1');
    const g1 = await seedGarage('ms1');
    await seedMembership({ garageId: g1, grossAmountCents: 3000, status: 'active' });
    const g2 = await seedGarage('ms2');
    await seedMembership({ garageId: g2, grossAmountCents: 3000, status: 'past_due' });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?kind=membership&membershipStatus=active',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.activeMembershipsCount).toBe(1);
  });

  it('kind=membership + cadence=monthly scopes MRR to monthly memberships only', async () => {
    const headers = await adminAuthHeader('mc1');
    const g1 = await seedGarage('mc1');
    await seedMembership({
      garageId: g1,
      cadence: 'monthly',
      grossAmountCents: 3000,
      status: 'active',
    });
    const g2 = await seedGarage('mc2');
    await seedMembership({
      garageId: g2,
      cadence: 'annual',
      grossAmountCents: 36000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?kind=membership&cadence=monthly',
      headers,
    });
    const body = res.json<Record<string, number>>();
    // Only monthly membership counts: MRR=3000, active=1.
    expect(body.membershipMRRCents).toBe(3000);
    expect(body.activeMembershipsCount).toBe(1);
  });

  it('kind=membership + tier=gold filters by tier', async () => {
    const headers = await adminAuthHeader('mt1');
    const g1 = await seedGarage('mt1');
    await seedMembership({ garageId: g1, tier: 'gold', grossAmountCents: 3000, status: 'active' });
    const g2 = await seedGarage('mt2');
    await seedMembership({
      garageId: g2,
      tier: 'silver',
      grossAmountCents: 2000,
      status: 'active',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?kind=membership&tier=gold',
      headers,
    });
    const body = res.json<Record<string, number>>();
    expect(body.activeMembershipsCount).toBe(1);
    expect(body.membershipMRRCents).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// /finance/trends — kind filter
// ---------------------------------------------------------------------------

describe('GET /admin/finance/trends — kind filter (F8.15 fix-up)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('kind=membership returns only membership-bearing points', async () => {
    const headers = await adminAuthHeader('tk1');
    const g1 = await seedGarage('tk1');
    await seedTicketOrder({
      garageId: g1,
      amountCents: 4000,
      paidAt: new Date('2026-01-10T10:00:00Z'),
    });
    const g2 = await seedGarage('tk2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 3000,
      paidAt: new Date('2026-01-20T10:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends?from=2026-01-01&to=2026-01-31&kind=membership',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ points: Array<Record<string, number | string>> }>();
    // Order-only day must NOT appear.
    expect(body.points.find((p) => p.date === '2026-01-10')).toBeUndefined();
    // Membership day surfaces with order fields zeroed.
    const memPoint = body.points.find((p) => p.date === '2026-01-20');
    expect(memPoint).toBeDefined();
    expect(memPoint!.membershipRevenueCents).toBe(3000);
    expect(memPoint!.orderCount).toBe(0);
  });

  it('kind=tickets excludes membership-only days entirely', async () => {
    const headers = await adminAuthHeader('tt1');
    const g1 = await seedGarage('tt1');
    await seedTicketOrder({
      garageId: g1,
      amountCents: 4000,
      paidAt: new Date('2026-01-10T10:00:00Z'),
    });
    const g2 = await seedGarage('tt2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 3000,
      paidAt: new Date('2026-01-20T10:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends?from=2026-01-01&to=2026-01-31&kind=tickets',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ points: Array<Record<string, number | string>> }>();
    // Ticket day appears.
    expect(body.points.find((p) => p.date === '2026-01-10')).toBeDefined();
    // Membership day excluded.
    expect(body.points.find((p) => p.date === '2026-01-20')).toBeUndefined();
  });

  it('undefined kind preserves existing behavior (regression guard)', async () => {
    const headers = await adminAuthHeader('tu1');
    const g1 = await seedGarage('tu1');
    await seedTicketOrder({
      garageId: g1,
      amountCents: 4000,
      paidAt: new Date('2026-01-10T10:00:00Z'),
    });
    const g2 = await seedGarage('tu2');
    const m = await seedMembership({ garageId: g2, grossAmountCents: 3000 });
    await seedInvoice({
      membershipId: m,
      grossAmountCents: 3000,
      paidAt: new Date('2026-01-20T10:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends?from=2026-01-01&to=2026-01-31',
      headers,
    });
    const body = res.json<{ points: Array<Record<string, number | string>> }>();
    expect(body.points.find((p) => p.date === '2026-01-10')).toBeDefined();
    expect(body.points.find((p) => p.date === '2026-01-20')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// /finance/payment-mix — kind filter
// ---------------------------------------------------------------------------

describe('GET /admin/finance/payment-mix — kind filter (F8.15 fix-up)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('kind=membership returns only subscription/storekit rows', async () => {
    const headers = await adminAuthHeader('pmk1');
    const g1 = await seedGarage('pmk1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('pmk2');
    const m = await seedMembership({ garageId: g2, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix?kind=membership',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, string | number>> }>();
    expect(body.items.find((i) => i.method === 'card')).toBeUndefined();
    expect(body.items.find((i) => i.method === 'subscription')).toBeDefined();
  });

  it('kind=tickets excludes subscription/storekit rows', async () => {
    const headers = await adminAuthHeader('pmt1');
    const g1 = await seedGarage('pmt1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('pmt2');
    const m = await seedMembership({ garageId: g2, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix?kind=tickets',
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<Record<string, string | number>> }>();
    expect(body.items.find((i) => i.method === 'subscription')).toBeUndefined();
    expect(body.items.find((i) => i.method === 'storekit')).toBeUndefined();
    expect(body.items.find((i) => i.method === 'card')).toBeDefined();
  });

  it('undefined kind preserves existing behavior (regression guard)', async () => {
    const headers = await adminAuthHeader('pmu1');
    const g1 = await seedGarage('pmu1');
    await seedTicketOrder({ garageId: g1, amountCents: 5000 });
    const g2 = await seedGarage('pmu2');
    const m = await seedMembership({ garageId: g2, provider: 'stripe', grossAmountCents: 3000 });
    await seedInvoice({ membershipId: m, provider: 'stripe', grossAmountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/payment-mix',
      headers,
    });
    const body = res.json<{ items: Array<Record<string, string | number>> }>();
    expect(body.items.find((i) => i.method === 'card')).toBeDefined();
    expect(body.items.find((i) => i.method === 'subscription')).toBeDefined();
  });
});
