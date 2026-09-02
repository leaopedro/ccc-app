/**
 * Which membership owns the box when a garage holds more than one eligible row.
 *
 * `loadEligibleMembership` returns an identity, not a boolean: the `id` selects
 * the MonthlyBox and the `tier` selects which catalog items the member may
 * choose. Picking the sibling row hands the member another subscription's box
 * and another subscription's tier.
 */
import { prisma } from '@ccc/db';
import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import type { PremiumMembershipStatus, PremiumCadence, GaragePremiumTier } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { loadEligibleMembership } from '../../src/routes/box.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';
import { futureCutoff } from './cutoff.js';

const env = loadEnv();

type MembershipSeed = {
  status: PremiumMembershipStatus;
  tier: GaragePremiumTier;
  cadence: PremiumCadence;
  ref: string;
  periodStart: string;
  periodEnd: string;
  createdAt?: Date;
};

const seedMembership = async (garageId: string, seed: MembershipSeed) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: 'cus_pick',
      providerSubRef: seed.ref,
      tier: seed.tier,
      cadence: seed.cadence,
      status: seed.status,
      currentPeriodStart: new Date(seed.periodStart),
      currentPeriodEnd: new Date(seed.periodEnd),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    },
  });

const seedBox = async (membership: { id: string; garageId: string }, cycleKey: string) =>
  prisma.monthlyBox.create({
    data: {
      membershipId: membership.id,
      garageId: membership.garageId,
      cycleKey,
      cycleStart: new Date(`${cycleKey}T00:00:00.000Z`),
      cycleEnd: new Date(`${cycleKey}T00:00:00.000Z`),
      cutoffAt: futureCutoff(),
      budgetCentsSnapshot: 15000,
    },
  });

const seedGarage = async (email: string) => {
  const { user } = await createUser({ verified: true, email });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, garage };
};

describe('loadEligibleMembership — which membership owns the box', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.boxSettings.upsert({
      where: { id: BOX_SETTINGS_SINGLETON_ID },
      update: { boxEnabled: true, shippingFeeCents: 0, freeShippingCepRanges: [] },
      create: {
        id: BOX_SETTINGS_SINGLETON_ID,
        boxEnabled: true,
        shippingFeeCents: 0,
        freeShippingCepRanges: [],
      },
    });
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('picks the active monthly over a trialing annual with a later currentPeriodEnd', async () => {
    const { user, garage } = await seedGarage('pick-active@jdm.test');
    // The row actually billing: monthly, silver, period ends this month.
    const active = await seedMembership(garage.id, {
      status: 'active',
      tier: 'silver',
      cadence: 'monthly',
      ref: 'sub_active_monthly',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
    });
    // A gold annual trial beside it. Not billing yet, but its period ends a
    // year later, so `currentPeriodEnd desc` used to hand it the box.
    const trial = await seedMembership(garage.id, {
      status: 'trialing',
      tier: 'gold',
      cadence: 'annual',
      ref: 'sub_trial_annual',
      periodStart: '2026-08-10T00:00:00.000Z',
      periodEnd: '2027-08-10T00:00:00.000Z',
    });
    const activeBox = await seedBox(active, '2026-08-01');
    await seedBox(trial, '2026-08-10');

    const picked = await loadEligibleMembership(user.id);
    expect(picked).toEqual({ id: active.id, tier: 'silver' });

    // The route surface follows: the member sees the box of the subscription
    // charging them, gated to the tier they are paying for.
    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(activeBox.id);
  });

  it('is deterministic when two trialing rows tie on every ordering column', async () => {
    const { user, garage } = await seedGarage('pick-tie@jdm.test');
    // Same createdAt on purpose: Postgres CURRENT_TIMESTAMP is transaction
    // start time, so rows written together really do tie in production.
    const bornAt = new Date('2026-08-05T12:00:00.000Z');
    const first = await seedMembership(garage.id, {
      status: 'trialing',
      tier: 'bronze',
      cadence: 'monthly',
      ref: 'sub_tie_a',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
      createdAt: bornAt,
    });
    const second = await seedMembership(garage.id, {
      status: 'trialing',
      tier: 'gold',
      cadence: 'monthly',
      ref: 'sub_tie_b',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
      createdAt: bornAt,
    });

    // id desc is the last resort and it is total: id is unique.
    const expected = [first, second].sort((a, b) => (a.id < b.id ? 1 : -1))[0]!;

    const picks = [];
    for (let i = 0; i < 5; i += 1) {
      picks.push(await loadEligibleMembership(user.id));
    }
    for (const pick of picks) {
      expect(pick).toEqual({ id: expected.id, tier: expected.tier });
    }
  });

  it('keeps the box for a trialing member whose only slot holder is past_due', async () => {
    // past_due holds the garage's live slot but is NOT box-eligible. The pick
    // must fall through to the trialing row instead of returning null.
    const { user, garage } = await seedGarage('pick-pastdue@jdm.test');
    await seedMembership(garage.id, {
      status: 'past_due',
      tier: 'gold',
      cadence: 'monthly',
      ref: 'sub_pastdue',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-07-31T00:00:00.000Z',
    });
    const trial = await seedMembership(garage.id, {
      status: 'trialing',
      tier: 'bronze',
      cadence: 'monthly',
      ref: 'sub_trial_only',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
    });
    const trialBox = await seedBox(trial, '2026-08-01');

    expect(await loadEligibleMembership(user.id)).toEqual({ id: trial.id, tier: 'bronze' });

    const res = await app.inject({
      method: 'GET',
      url: '/me/box',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(trialBox.id);
  });

  it('flags the same history entry as current when two boxes share a cycleStart', async () => {
    const { user, garage } = await seedGarage('pick-history@jdm.test');
    const active = await seedMembership(garage.id, {
      status: 'active',
      tier: 'silver',
      cadence: 'monthly',
      ref: 'sub_hist_active',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
    });
    const trial = await seedMembership(garage.id, {
      status: 'trialing',
      tier: 'gold',
      cadence: 'annual',
      ref: 'sub_hist_trial',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2027-08-01T00:00:00.000Z',
    });
    // Same cycleStart, different memberships: cycleStart desc alone leaves the
    // `current` flag to whatever Postgres feels like returning first.
    await seedBox(active, '2026-08-01');
    await seedBox(trial, '2026-08-01');

    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/me/boxes',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { id: string; current: boolean }[];
      expect(body.filter((b) => b.current)).toHaveLength(1);
      seen.add(body.find((b) => b.current)!.id);
    }
    expect(seen.size).toBe(1);
  });

  it('returns null when no row is box-eligible', async () => {
    const { user, garage } = await seedGarage('pick-none@jdm.test');
    await seedMembership(garage.id, {
      status: 'paused',
      tier: 'gold',
      cadence: 'monthly',
      ref: 'sub_paused',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T00:00:00.000Z',
    });
    expect(await loadEligibleMembership(user.id)).toBeNull();
  });
});
