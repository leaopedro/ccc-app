import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

/**
 * These tests pin canon §F8.2: sourceRef = 'garage:<garageId>' is the shared
 * idempotency key across admin-grant (admin/user-garage.ts) and self-serve
 * webhook (apply-membership-event.ts). One-shot-ever per garage.
 */

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const makeActivatedEvt = (
  gid: string,
  providerSubRef = 'sub_idempotency_test',
  providerInvoiceRef = 'in_idempotency_001',
): Extract<BillingEvent, { kind: 'subscription.activated' }> => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_idempotency',
  providerSubRef,
  garageId: gid,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date('2026-06-01'),
  currentPeriodEnd: new Date('2026-07-01'),
  pricing: {
    baseAmountCents: 2990,
    devFeePercent: 10,
    devFeeAmountCents: 299,
    grossAmountCents: 3289,
    currency: 'BRL',
  },
  // `providerTransactionRef` omitted: exactOptionalPropertyTypes rejects
  // explicit `undefined` on optional fields. Apple-only.
  invoice: {
    providerInvoiceRef,
    periodStart: new Date('2026-06-01'),
    periodEnd: new Date('2026-07-01'),
    paidAt: new Date('2026-06-01'),
  },
});

/** Helper: simulate the admin-grant path's XP award call (same sourceRef contract). */
const adminGrantXp = async (gid: string): Promise<void> => {
  const { awardXp } = await import('../../src/services/garage/xp-awarder.js');
  await prisma.$transaction((tx) =>
    awardXp(tx, gid, 'premium_activation', { sourceRef: `garage:${gid}`, delta: 200 }),
  );
};

describe('premium_activation XP idempotency — admin grant ↔ webhook (canon §F8.2)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('admin grant first, then webhook activation — XP awarded only once (200 total)', async () => {
    const { user } = await createUser({ email: 'idem1@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Admin grants premium first (simulates the admin-grant route's awardXp call).
    await adminGrantXp(gid);

    // Webhook fires.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, makeActivatedEvt(gid));
    });

    const xpEvents = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(xpEvents).toHaveLength(1); // ONE row, not two.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });

  it('webhook activation first, then admin grant — XP awarded only once (200 total)', async () => {
    const { user } = await createUser({ email: 'idem2@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Webhook fires first.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, makeActivatedEvt(gid, 'sub_idem2', 'in_idem2'));
    });

    // Admin grant runs afterward.
    await adminGrantXp(gid);

    const xpEvents = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(xpEvents).toHaveLength(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });

  it('double webhook activation with same providerSubRef — XP awarded only once', async () => {
    const { user } = await createUser({ email: 'idem3@jdm.test', verified: true });
    const gid = await garageId(user.id);

    const evt = makeActivatedEvt(gid, 'sub_double', 'in_double_001');

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evt);
    });

    // Replay: same event, second time.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evt);
    });

    const xpEvents = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'premium_activation' },
    });
    expect(xpEvents).toHaveLength(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });
});
