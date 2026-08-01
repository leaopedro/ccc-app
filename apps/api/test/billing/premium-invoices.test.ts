import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedMembership = (garageId: string, subRef: string) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${subRef}`,
      providerSubRef: subRef,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 149000,
      devFeePercent: 10,
      devFeeAmountCents: 14900,
      grossAmountCents: 163900,
      currency: 'BRL',
    },
  });

const seedInvoice = (membershipId: string, ref: string, monthIso: string) =>
  prisma.premiumMembershipInvoice.create({
    data: {
      membershipId,
      provider: 'stripe',
      providerInvoiceRef: ref,
      periodStart: new Date(monthIso),
      periodEnd: new Date(monthIso),
      baseAmountCents: 149000,
      devFeePercent: 10,
      devFeeAmountCents: 14900,
      grossAmountCents: 163900,
      currency: 'BRL',
      paidAt: new Date(monthIso),
      status: 'paid',
    },
  });

describe('GET /api/me/premium/invoices', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns an empty list when there are no invoices', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'empty@jdm.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/invoices',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invoices: [] });
    await app.close();
  });

  it('orders newest first and never leaks provider refs', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'hist@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await seedMembership(garage.id, 'sub_hist_1');
    await seedInvoice(membership.id, 'in_may', '2026-05-01T00:00:00.000Z');
    await seedInvoice(membership.id, 'in_july', '2026-07-01T00:00:00.000Z');
    await seedInvoice(membership.id, 'in_june', '2026-06-01T00:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/invoices',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { invoices: Array<{ periodStart: string }> };
    expect(body.invoices.map((i) => i.periodStart)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
    ]);
    expect(res.payload).not.toContain('in_july');
    expect(res.payload).not.toContain('providerInvoiceRef');
    await app.close();
  });

  it('does not leak another user invoices', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user: a } = await createUser({ email: 'a@jdm.test' });
    const { user: b } = await createUser({ email: 'b@jdm.test' });
    const garageB = await prisma.garage.findUniqueOrThrow({ where: { userId: b.id } });
    const membershipB = await seedMembership(garageB.id, 'sub_hist_b');
    await seedInvoice(membershipB.id, 'in_b', '2026-07-01T00:00:00.000Z');

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/invoices',
      headers: { authorization: bearer(env, a.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ invoices: [] });
    await app.close();
  });
});
