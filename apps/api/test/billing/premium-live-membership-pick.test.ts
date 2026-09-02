/**
 * Which row is "the garage's live membership" when there is more than one.
 *
 * The partial unique index only covers three of the five
 * LIVE_MEMBERSHIP_STATUSES (active, past_due, cancel_scheduled), so a
 * `trialing` or `paused` row can legally sit beside the row that is actually
 * billing. Before pickLiveMembership, the reads over the wide list carried no
 * `orderBy` at all, and Postgres was free to hand back either row.
 *
 * It was not even coin-flip random when measured. The planner served these
 * reads from `PremiumMembership_garageId_status_idx` (garageId, status), so
 * rows came back in enum declaration order — trialing, active, past_due,
 * cancel_scheduled, expired, paused — and a `trialing` sibling won over the
 * `active` row in both insert orders. That is the reproduction pinned below:
 * the member taps Cancelar, Stripe cancels the trial, and the subscription
 * charging them every month survives untouched while the app says they
 * cancelled.
 *
 * Plan choice is not a promise, though: new statistics or a Postgres upgrade
 * can hand back the other row instead. The bug being fixed is the missing
 * ordering, not the specific row that happened to win, so these tests assert
 * the CORRECT row wins in BOTH insert orders and never encode which row the
 * broken code returned.
 */
import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { pickLiveMembership } from '../../src/services/billing/live-membership.js';
import { bearer, createUser, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

type SeedOverrides = {
  status: string;
  ref: string;
  cadence?: 'monthly' | 'annual';
  createdAt?: Date;
  currentPeriodEnd?: Date;
};

const seedMembership = async (garageId: string, o: SeedOverrides) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${o.ref}`,
      providerSubRef: `sub_${o.ref}`,
      tier: 'gold',
      cadence: (o.cadence ?? 'monthly') as 'monthly',
      status: o.status as 'active',
      currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: o.currentPeriodEnd ?? new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 149000,
      devFeePercent: 10,
      devFeeAmountCents: 14900,
      grossAmountCents: 163900,
      currency: 'BRL',
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });

const garageFor = async (email: string) => {
  const { user } = await createUser({ email });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return { userId: user.id, garageId: garage.id };
};

const cancelledSubRef = (calls: { kind: string; payload: unknown }[]): string | undefined => {
  const call = calls.find((c) => c.kind === 'cancelSubscriptionAtPeriodEnd');
  return (call?.payload as { subscriptionId?: string } | undefined)?.subscriptionId;
};

describe('live membership pick — the billing row wins', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // The reproduction: cancel must not hit the sibling.
  // -------------------------------------------------------------------------

  it.each([
    ['trialing seeded first', 'trialing', true],
    ['trialing seeded last', 'trialing', false],
    ['paused seeded first', 'paused', true],
    ['paused seeded last', 'paused', false],
  ])(
    'cancels the active subscription, not the sibling (%s)',
    async (label, siblingStatus, siblingFirst) => {
      const { app, stripe } = await makeAppWithFakeStripe();
      const { userId, garageId } = await garageFor(
        `pick-${siblingStatus}-${siblingFirst}@jdm.test`,
      );
      stripe.nextCancelledSubscription = { cancelAtPeriodEnd: true };

      const sibling = {
        status: siblingStatus,
        ref: `sibling_${siblingStatus}`,
        createdAt: new Date(siblingFirst ? '2026-01-01T00:00:00.000Z' : '2026-06-01T00:00:00.000Z'),
      };
      const billing = {
        status: 'active',
        ref: 'billing',
        createdAt: new Date(siblingFirst ? '2026-06-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z'),
      };
      if (siblingFirst) {
        await seedMembership(garageId, sibling);
        await seedMembership(garageId, billing);
      } else {
        await seedMembership(garageId, billing);
        await seedMembership(garageId, sibling);
      }

      const res = await app.inject({
        method: 'POST',
        url: '/api/me/premium/cancel',
        headers: { authorization: bearer(env, userId) },
      });

      expect(res.statusCode).toBe(200);
      expect(cancelledSubRef(stripe.calls)).toBe('sub_billing');
      await app.close();
    },
  );

  // -------------------------------------------------------------------------
  // Screen and action must describe the same row.
  // -------------------------------------------------------------------------

  it('GET /status describes the same row POST /cancel acts on', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { userId, garageId } = await garageFor('pick-agree@jdm.test');
    stripe.nextCancelledSubscription = { cancelAtPeriodEnd: true };

    // The trialing row is the newest AND first in the (garageId, status) index
    // order, so both the old unordered reads and a plain newest-first order
    // would have picked it.
    await seedMembership(garageId, {
      status: 'active',
      ref: 'billing',
      cadence: 'monthly',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    });
    await seedMembership(garageId, {
      status: 'trialing',
      ref: 'trial',
      cadence: 'annual',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2027-06-01T00:00:00.000Z'),
    });

    const headers = { authorization: bearer(env, userId) };
    const status = await app.inject({ method: 'GET', url: '/api/me/premium/status', headers });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      active: true,
      cadence: 'monthly',
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });

    const cancel = await app.inject({ method: 'POST', url: '/api/me/premium/cancel', headers });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().currentPeriodEnd).toBe('2026-08-01T00:00:00.000Z');
    expect(cancelledSubRef(stripe.calls)).toBe('sub_billing');

    await app.close();
  });

  it('checkout precheck mints the manage url for the billing row customer', async () => {
    const { app, stripe } = await makeAppWithFakeStripe();
    const { userId, garageId } = await garageFor('pick-precheck@jdm.test');

    await seedMembership(garageId, {
      status: 'trialing',
      ref: 'trial',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    await seedMembership(garageId, {
      status: 'past_due',
      ref: 'billing',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/me/premium/checkout-precheck',
      headers: { authorization: bearer(env, userId) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('AlreadySubscribed');
    const portalCall = stripe.calls.find((c) => c.kind === 'createBillingPortalSession');
    expect((portalCall?.payload as { customerId: string }).customerId).toBe('cus_billing');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // The helper itself.
  // -------------------------------------------------------------------------

  it('falls back to newest when no row holds the live slot', async () => {
    const { garageId } = await garageFor('pick-fallback@jdm.test');
    // Neither status is covered by the partial unique index, so rule 1 finds
    // nothing and rule 2 (createdAt desc, id desc) decides.
    await seedMembership(garageId, {
      status: 'paused',
      ref: 'older',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await seedMembership(garageId, {
      status: 'trialing',
      ref: 'newer',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    const picked = await pickLiveMembership(prisma, garageId);
    expect(picked?.providerSubRef).toBe('sub_newer');
  });

  it('ignores expired rows however recent they are', async () => {
    const { garageId } = await garageFor('pick-expired@jdm.test');
    await seedMembership(garageId, {
      status: 'active',
      ref: 'billing',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await seedMembership(garageId, {
      status: 'expired',
      ref: 'old',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    const picked = await pickLiveMembership(prisma, garageId);
    expect(picked?.providerSubRef).toBe('sub_billing');
  });

  it('returns null when every row is expired', async () => {
    const { garageId } = await garageFor('pick-none@jdm.test');
    await seedMembership(garageId, { status: 'expired', ref: 'gone' });
    expect(await pickLiveMembership(prisma, garageId)).toBeNull();
  });
});
