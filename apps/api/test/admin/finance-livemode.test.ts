// Task 4 — `livemode` filter on GET /admin/finance/*.
//
// Covers three things:
//   1. Order-derived revenue: `livemode` defaults to `live`, is filterable to
//      `test` or `all`, and applies consistently across summary/trends/export.
//   2. Membership metrics split: PremiumMembershipInvoice-derived figures ARE
//      scoped by `livemode`; PremiumMembership-derived figures (active count,
//      MRR, ARPU, new/churned counts) are NOT — that table has no `livemode`
//      column — and the response says so explicitly via
//      `membershipCountsLivemodeFiltered: false`.
//   3. `livemodeBackfillPending`: an evidence-based diagnostic (not a guessed
//      cutover date) that flags when `mark-pre-cutover-orders` has apparently
//      never run, so a reader of the default `live` total knows it might still
//      include pre-cutover test money.
import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

async function adminAuthHeader(): Promise<{ authorization: string }> {
  const { user } = await createUser({
    email: `fin-livemode-${Math.random().toString(36).slice(2, 10)}@jdm-test.local`,
    verified: true,
    role: 'admin',
  });
  return { authorization: bearer(env, user.id, 'admin') };
}

describe('GET /admin/finance/summary — livemode (order revenue)', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    auth = await adminAuthHeader();

    const { user: buyer } = await createUser({
      email: `buyer-${Math.random().toString(36).slice(2, 10)}@jdm-test.local`,
      verified: true,
    });
    await prisma.order.createMany({
      data: [
        {
          userId: buyer.id,
          amountCents: 10_000,
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date('2026-09-02T12:00:00.000Z'),
          livemode: true,
        },
        {
          userId: buyer.id,
          amountCents: 999_00,
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date('2026-08-20T12:00:00.000Z'),
          livemode: false,
        },
      ],
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('excludes test-mode revenue by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalRevenueCents).toBe(10_000);
  });

  it('returns only test-mode revenue when asked', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?livemode=test',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalRevenueCents).toBe(999_00);
  });

  it('returns both when asked for all', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?livemode=all',
      headers: auth,
    });
    expect(res.json().totalRevenueCents).toBe(10_000 + 999_00);
  });

  it('rejects an out-of-enum livemode value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?livemode=bogus',
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies the same default on the trends endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/trends',
      headers: auth,
    });
    const total = res
      .json()
      .points.reduce((sum: number, p: { revenueCents: number }) => sum + p.revenueCents, 0);
    expect(total).toBe(10_000);
  });

  it('applies the same default on the export endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/export',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('99900');
  });
});

// ---------------------------------------------------------------------------
// Membership metrics: invoice-derived figures ARE livemode-scoped;
// PremiumMembership-derived figures are NOT (no column to scope by).
// ---------------------------------------------------------------------------

async function seedGarage(): Promise<string> {
  const { user } = await createUser({
    email: `garage-${Math.random().toString(36).slice(2, 10)}@jdm-test.local`,
    verified: true,
    role: 'user',
  });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return garage.id;
}

async function seedMembership(garageId: string, grossAmountCents: number): Promise<string> {
  const m = await prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_test_${Math.random().toString(36).slice(2)}`,
      providerSubRef: `sub_test_${Math.random().toString(36).slice(2)}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      grossAmountCents,
      devFeeAmountCents: 0,
      devFeePercent: 0,
      baseAmountCents: grossAmountCents,
      currency: 'BRL',
    },
  });
  return m.id;
}

async function seedInvoice(
  membershipId: string,
  grossAmountCents: number,
  livemode: boolean,
): Promise<void> {
  await prisma.premiumMembershipInvoice.create({
    data: {
      membershipId,
      provider: 'stripe',
      providerInvoiceRef: `inv_test_${Math.random().toString(36).slice(2)}`,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-09-01T00:00:00Z'),
      grossAmountCents,
      devFeeAmountCents: 0,
      devFeePercent: 0,
      baseAmountCents: grossAmountCents,
      currency: 'BRL',
      paidAt: new Date('2026-08-15T10:00:00Z'),
      status: 'paid',
      livemode,
    },
  });
}

describe('GET /admin/finance/summary — livemode (membership metrics split)', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    auth = await adminAuthHeader();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('filters invoice-derived membership revenue by livemode, but NOT the PremiumMembership-derived counts', async () => {
    // One active membership whose only invoice is a legacy test-mode invoice
    // (livemode=false) that survived because purge-test-mode.ts never expired
    // the membership itself — a realistic post-cutover-backfill shape.
    const garageId = await seedGarage();
    const membershipId = await seedMembership(garageId, 5_000);
    await seedInvoice(membershipId, 5_000, false);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Invoice-derived: the test-mode invoice is excluded by the default `live` scope.
    expect(body.membershipRevenueCents).toBe(0);
    expect(body.membershipNetRevenueCents).toBe(0);

    // PremiumMembership-derived: no `livemode` column exists there, so the
    // active membership and its MRR/ARPU inputs are unaffected by the filter.
    expect(body.activeMembershipsCount).toBe(1);
    expect(body.membershipMRRCents).toBe(5_000);

    // The response says, in-band, that these counts are not livemode-scoped.
    expect(body.membershipCountsLivemodeFiltered).toBe(false);
  });

  it('includes the invoice revenue once livemode=all is requested, counts stay identical', async () => {
    const garageId = await seedGarage();
    const membershipId = await seedMembership(garageId, 5_000);
    await seedInvoice(membershipId, 5_000, false);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary?livemode=all',
      headers: auth,
    });
    const body = res.json();
    expect(body.membershipRevenueCents).toBe(5_000);
    expect(body.activeMembershipsCount).toBe(1);
    expect(body.membershipMRRCents).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// livemodeBackfillPending diagnostic
// ---------------------------------------------------------------------------

describe('GET /admin/finance/summary — livemodeBackfillPending', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    auth = await adminAuthHeader();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('is true when no Order or PremiumMembershipInvoice row has ever been marked test-mode', async () => {
    const { user: buyer } = await createUser({
      email: `buyer2-${Math.random().toString(36).slice(2, 10)}@jdm-test.local`,
      verified: true,
    });
    // Only livemode=true rows exist — indistinguishable, from this table
    // alone, from "the backfill script has never run".
    await prisma.order.create({
      data: {
        userId: buyer.id,
        amountCents: 10_000,
        method: 'card',
        provider: 'stripe',
        status: 'paid',
        paidAt: new Date('2026-09-02T12:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: auth,
    });
    expect(res.json().livemodeBackfillPending).toBe(true);
  });

  it('is false once at least one row has been marked test-mode (Order side)', async () => {
    const { user: buyer } = await createUser({
      email: `buyer3-${Math.random().toString(36).slice(2, 10)}@jdm-test.local`,
      verified: true,
    });
    await prisma.order.createMany({
      data: [
        {
          userId: buyer.id,
          amountCents: 10_000,
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date('2026-09-02T12:00:00.000Z'),
          livemode: true,
        },
        {
          userId: buyer.id,
          amountCents: 500,
          method: 'card',
          provider: 'stripe',
          status: 'paid',
          paidAt: new Date('2026-08-01T12:00:00.000Z'),
          livemode: false,
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: auth,
    });
    expect(res.json().livemodeBackfillPending).toBe(false);
  });

  it('is false once at least one row has been marked test-mode (membership invoice side)', async () => {
    const garageId = await seedGarage();
    const membershipId = await seedMembership(garageId, 5_000);
    await seedInvoice(membershipId, 5_000, false);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: auth,
    });
    expect(res.json().livemodeBackfillPending).toBe(false);
  });

  it('is true on a completely empty database (no false signal without evidence)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/finance/summary',
      headers: auth,
    });
    expect(res.json().livemodeBackfillPending).toBe(true);
  });
});
