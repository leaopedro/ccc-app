import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { purgeTestMode } from '../../src/scripts/purge-test-mode.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedMembership = async (
  garageId: string,
  refs: { customer: string; sub: string },
  status: 'active' | 'past_due' | 'cancel_scheduled' | 'expired' = 'active',
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: refs.customer,
      providerSubRef: refs.sub,
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
    },
  });

const seedGarage = async (email: string) => {
  const { user } = await createUser({ email, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.garage.update({
    where: { id: garage.id },
    data: { premiumTier: 'gold', premiumUntil: new Date('2026-06-01T00:00:00Z') },
  });
  return { userId: user.id, garageId: garage.id };
};

describe('purgeTestMode', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('expires test-mode memberships and clears the garage entitlement snapshot', async () => {
    const { garageId } = await seedGarage('purge-test@jdm.test');
    await seedMembership(garageId, { customer: 'cus_test_abc', sub: 'sub_test_abc' });

    const result = await purgeTestMode(prisma);

    expect(result.memberships).toBe(1);
    expect(result.garages).toBe(1);

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.status).toBe('expired');

    // The entitlement snapshot is the part that produces permanent free premium.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();
  });

  it('leaves live-mode rows untouched', async () => {
    const { garageId } = await seedGarage('purge-live@jdm.test');
    await seedMembership(garageId, { customer: 'cus_live_abc', sub: 'sub_live_abc' });

    const result = await purgeTestMode(prisma);

    expect(result.memberships).toBe(0);
    expect(result.garages).toBe(0);

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.status).toBe('active');
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
  });

  it('catches a test-mode customer ref even when the subscription ref looks live', async () => {
    const { garageId } = await seedGarage('purge-mixed@jdm.test');
    await seedMembership(garageId, { customer: 'cus_test_mixed', sub: 'sub_live_mixed' });

    const result = await purgeTestMode(prisma);

    expect(result.memberships).toBe(1);
  });

  it('expires pending orders holding a test-mode payment ref', async () => {
    const { userId } = await seedGarage('purge-order@jdm.test');
    const order = await prisma.order.create({
      data: {
        userId,
        amountCents: 5000,
        quantity: 1,
        method: 'card',
        provider: 'stripe',
        providerRef: 'pi_test_pending',
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });

    const result = await purgeTestMode(prisma);

    expect(result.orders).toBe(1);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('expired');
  });

  it('dry run reports counts and writes nothing', async () => {
    const { garageId } = await seedGarage('purge-dry@jdm.test');
    await seedMembership(garageId, { customer: 'cus_test_dry', sub: 'sub_test_dry' });

    const result = await purgeTestMode(prisma, { dryRun: true });

    expect(result.memberships).toBe(1);

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.status).toBe('active');
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
  });

  it('skips memberships already expired so reruns are cheap and idempotent', async () => {
    const { garageId } = await seedGarage('purge-idem@jdm.test');
    await seedMembership(garageId, { customer: 'cus_test_idem', sub: 'sub_test_idem' });

    await purgeTestMode(prisma);
    const second = await purgeTestMode(prisma);

    expect(second.memberships).toBe(0);
  });
});
