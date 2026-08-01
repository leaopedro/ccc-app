import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

const seedMembership = async (
  garageId: string,
  overrides: Partial<{
    provider: 'stripe' | 'apple_revenuecat';
    status: string;
    providerCustomerRef: string;
    providerSubRef: string;
  }> = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: overrides.provider ?? 'stripe',
      providerCustomerRef: overrides.providerCustomerRef ?? 'cus_cancel_1',
      providerSubRef: overrides.providerSubRef ?? 'sub_cancel_1',
      tier: 'gold',
      cadence: 'monthly',
      status: (overrides.status ?? 'active') as 'active',
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

describe('POST /api/me/premium/cancel', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated request', async () => {
    const { app } = await makeAppWithFakeStripe();
    const res = await app.inject({ method: 'POST', url: '/api/me/premium/cancel' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('404s when there is no live membership', async () => {
    const { app } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'nolive@jdm.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('calls Stripe with cancel_at_period_end and does NOT write the DB', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'cancel@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const membership = await seedMembership(garage.id);
    // currentPeriodEnd is no longer part of Stripe's response shape (it is a
    // per-item field, not subscription-wide); the route reads the date off
    // the DB row instead, so only cancelAtPeriodEnd is stubbed here.
    stripe.nextCancelledSubscription = {
      cancelAtPeriodEnd: true,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });

    const call = stripe.calls.find((c) => c.kind === 'cancelSubscriptionAtPeriodEnd');
    expect(call?.payload).toEqual({
      subscriptionId: 'sub_cancel_1',
      idempotencyKey: `cancel_sub_${membership.id}`,
    });

    // Invariant: only the verified webhook mutates subscription state.
    const after = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(after.status).toBe('active');
    expect(after.cancelAtPeriodEnd).toBe(false);
    expect(after.cancelledAt).toBeNull();

    await app.close();
  });

  it('409s with the App Store manage url for an Apple membership', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'apple@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id, { provider: 'apple_revenuecat' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'NotStripeSubscription',
      provider: 'apple_revenuecat',
      manageUrl: 'https://apps.apple.com/account/subscriptions',
    });
    expect(stripe.calls.some((c) => c.kind === 'cancelSubscriptionAtPeriodEnd')).toBe(false);

    await app.close();
  });

  it('rate limits cancel at 5 requests per minute', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { user } = await createUser({ email: 'rl@jdm.test' });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedMembership(garage.id);
    // currentPeriodEnd is not part of CancelSubscriptionAtPeriodEndResult (the
    // route reads it from the DB row, not Stripe's response) — see the same
    // note on the 'calls Stripe with cancel_at_period_end' test above.
    stripe.nextCancelledSubscription = {
      cancelAtPeriodEnd: true,
    };
    const headers = { authorization: bearer(env, user.id) };

    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/api/me/premium/cancel', headers });
      codes.push(res.statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
    await app.close();
  });

  it('rate limits per user, not per IP: a throttled user does not block a different user', async () => {
    // Regression guard for the key generator falling back to req.ip: if that
    // happened, both users (same synthetic app.inject IP) would share one
    // bucket and user B would also see 429. Both users are exercised against
    // the SAME app instance so the rate-limit store's window is shared,
    // which is the only way this test can distinguish a per-user key from a
    // per-IP one.
    const { app, stripe } = await makeAppWithFakeStripe();
    stripe.nextCancelledSubscription = { cancelAtPeriodEnd: true };

    const { user: userA } = await createUser({ email: 'rl-a@jdm.test' });
    const garageA = await prisma.garage.findUniqueOrThrow({ where: { userId: userA.id } });
    await seedMembership(garageA.id, {
      providerCustomerRef: 'cus_cancel_a',
      providerSubRef: 'sub_cancel_a',
    });
    const headersA = { authorization: bearer(env, userA.id) };

    const codesA: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/premium/cancel',
        headers: headersA,
      });
      codesA.push(res.statusCode);
    }
    expect(codesA.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codesA[5]).toBe(429);

    const { user: userB } = await createUser({ email: 'rl-b@jdm.test' });
    const garageB = await prisma.garage.findUniqueOrThrow({ where: { userId: userB.id } });
    await seedMembership(garageB.id, {
      providerCustomerRef: 'cus_cancel_b',
      providerSubRef: 'sub_cancel_b',
    });
    const headersB = { authorization: bearer(env, userB.id) };

    const resB = await app.inject({
      method: 'POST',
      url: '/api/me/premium/cancel',
      headers: headersB,
    });
    expect(resB.statusCode).toBe(200);

    await app.close();
  });
});
