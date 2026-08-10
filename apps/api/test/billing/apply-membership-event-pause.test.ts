import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import { createUser, resetDatabase } from '../helpers.js';

const PERIOD_START = new Date('2026-08-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-09-01T00:00:00.000Z');

async function seedMembership(status: 'active' | 'paused') {
  const { user } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.garage.update({
    where: { id: garage.id },
    data: { premiumTier: 'gold', premiumUntil: PERIOD_END },
  });
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_1',
      providerSubRef: 'sub_1',
      tier: 'gold',
      cadence: 'monthly',
      status,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      baseAmountCents: 149000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 149000,
      currency: 'BRL',
    },
  });
  return { garageId: garage.id, membershipId: membership.id };
}

describe('applyMembershipEvent: paused e resumed', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it('paused muda o status e nao toca no snapshot da garagem', async () => {
    const { garageId, membershipId } = await seedMembership('active');

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.paused',
        provider: 'stripe',
        providerSubRef: 'sub_1',
      });
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.status).toBe('paused');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil?.toISOString()).toBe(PERIOD_END.toISOString());
  });

  it('resumed volta para active e reaplica o snapshot com a regra de max', async () => {
    const { garageId, membershipId } = await seedMembership('paused');
    const farFuture = new Date('2027-01-01T00:00:00.000Z');
    await prisma.garage.update({
      where: { id: garageId },
      data: { premiumTier: null, premiumUntil: farFuture },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.resumed',
        provider: 'stripe',
        providerSubRef: 'sub_1',
      });
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.status).toBe('active');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    // max() rule: a concessao manual mais distante nao pode ser encurtada.
    expect(garage.premiumUntil?.toISOString()).toBe(farFuture.toISOString());
  });

  it('resumed limpa a flag de cancelamento agendado', async () => {
    const { garageId, membershipId } = await seedMembership('paused');
    await prisma.premiumMembership.update({
      where: { id: membershipId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageId} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.resumed',
        provider: 'stripe',
        providerSubRef: 'sub_1',
      });
    });

    const membership = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.cancelAtPeriodEnd).toBe(false);
    expect(membership.cancelledAt).toBeNull();
  });
});
