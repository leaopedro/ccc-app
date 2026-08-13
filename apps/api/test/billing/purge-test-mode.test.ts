import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { purgeTestMode } from '../../src/scripts/purge-test-mode.js';
import { createUser, resetDatabase } from '../helpers.js';

// The cutover instant. Rows created before it are test-mode by definition,
// because production accepted no live payment before that point. See the long
// comment in the script for why the ids themselves cannot be used: Stripe
// test-mode ids for Customer, Subscription and PaymentIntent are shaped exactly
// like live ones.
const CUTOVER = new Date('2026-08-20T00:00:00Z');
const BEFORE = new Date('2026-08-01T00:00:00Z');
const AFTER = new Date('2026-08-25T00:00:00Z');

const seedMembership = async (
  garageId: string,
  createdAt: Date,
  status: 'active' | 'past_due' | 'cancel_scheduled' | 'expired' = 'active',
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: 'cus_NffrFeUfNV2Hib',
      providerSubRef: `sub_${Math.random().toString(36).slice(2, 12)}`,
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
      createdAt,
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

  it('expires pre-cutover memberships and clears the garage entitlement snapshot', async () => {
    const { garageId } = await seedGarage('purge-pre@jdm.test');
    await seedMembership(garageId, BEFORE);

    const result = await purgeTestMode(prisma, { createdBefore: CUTOVER });

    expect(result.memberships).toBe(1);
    expect(result.garages).toBe(1);

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.status).toBe('expired');

    // The entitlement snapshot is the part that produces permanent free premium.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();
  });

  it('leaves post-cutover rows untouched', async () => {
    const { garageId } = await seedGarage('purge-post@jdm.test');
    await seedMembership(garageId, AFTER);

    const result = await purgeTestMode(prisma, { createdBefore: CUTOVER });

    expect(result.memberships).toBe(0);
    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.status).toBe('active');
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
  });

  it('releases the stock a purged pending order was holding', async () => {
    // Setting `expired` directly would leave quantitySold inflated forever: the
    // regular expiry sweeps only look at `pending` rows, so nothing repairs it.
    const { userId } = await seedGarage('purge-stock@jdm.test');
    const event = await prisma.event.create({
      data: {
        slug: `purge-ev-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Evento purga',
        description: 'desc',
        startsAt: new Date('2026-09-01T18:00:00Z'),
        endsAt: new Date('2026-09-01T22:00:00Z'),
        type: 'meeting',
        status: 'published',
        capacity: 10,
      },
    });
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Geral',
        priceCents: 5000,
        quantityTotal: 10,
        quantitySold: 3,
      },
    });
    const order = await prisma.order.create({
      data: {
        userId,
        eventId: event.id,
        tierId: tier.id,
        kind: 'ticket',
        amountCents: 5000,
        quantity: 2,
        method: 'card',
        provider: 'stripe',
        status: 'pending',
        createdAt: BEFORE,
        expiresAt: new Date('2026-08-01T00:15:00Z'),
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        kind: 'ticket',
        tierId: tier.id,
        quantity: 2,
        unitPriceCents: 5000,
        subtotalCents: 10000,
      },
    });

    const result = await purgeTestMode(prisma, { createdBefore: CUTOVER });

    expect(result.orders).toBe(1);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('expired');
    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.quantitySold).toBe(1);
  });

  it('dry run reports counts and writes nothing', async () => {
    const { garageId } = await seedGarage('purge-dry@jdm.test');
    await seedMembership(garageId, BEFORE);

    const result = await purgeTestMode(prisma, { createdBefore: CUTOVER, dryRun: true });

    expect(result.memberships).toBe(1);

    const membership = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId } });
    expect(membership.status).toBe('active');
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
  });

  it('skips memberships already expired so reruns are cheap and idempotent', async () => {
    const { garageId } = await seedGarage('purge-idem@jdm.test');
    await seedMembership(garageId, BEFORE);

    await purgeTestMode(prisma, { createdBefore: CUTOVER });
    const second = await purgeTestMode(prisma, { createdBefore: CUTOVER });

    expect(second.memberships).toBe(0);
  });
});
