import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyInvoiceRefund,
  applyMembershipEvent,
} from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const garageId = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const BASE_PRICING = {
  baseAmountCents: 2990,
  devFeePercent: 10,
  devFeeAmountCents: 299,
  grossAmountCents: 3289,
  currency: 'BRL',
};

// `providerTransactionRef` omitted: `exactOptionalPropertyTypes: true`
// rejects explicit `undefined` on optional fields. Apple-only field.
const BASE_INVOICE = {
  providerInvoiceRef: 'in_test_001',
  periodStart: new Date('2026-06-01'),
  periodEnd: new Date('2026-07-01'),
  paidAt: new Date('2026-06-01'),
};

const buildActivatedEvt = (
  gid: string,
  overrides: Partial<Extract<BillingEvent, { kind: 'subscription.activated' }>> = {},
): Extract<BillingEvent, { kind: 'subscription.activated' }> => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_test001',
  providerSubRef: 'sub_test001',
  garageId: gid,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date('2026-06-01'),
  currentPeriodEnd: new Date('2026-07-01'),
  pricing: BASE_PRICING,
  invoice: BASE_INVOICE,
  ...overrides,
});

const buildRenewedEvt = (
  providerSubRef: string,
  overrides: Partial<Extract<BillingEvent, { kind: 'subscription.renewed' }>> = {},
): Extract<BillingEvent, { kind: 'subscription.renewed' }> => ({
  kind: 'subscription.renewed',
  provider: 'stripe',
  providerSubRef,
  currentPeriodStart: new Date('2026-07-01'),
  currentPeriodEnd: new Date('2026-08-01'),
  pricing: BASE_PRICING,
  invoice: {
    ...BASE_INVOICE,
    providerInvoiceRef: 'in_test_002',
    periodStart: new Date('2026-07-01'),
    periodEnd: new Date('2026-08-01'),
  },
  ...overrides,
});

describe('applyMembershipEvent', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // -- subscription.activated --

  it('activated: creates PremiumMembership + Invoice + Garage snapshot + XP', async () => {
    const { user } = await createUser({ email: 'am1@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership).not.toBeNull();
    expect(membership!.status).toBe('active');
    expect(membership!.tier).toBe('gold');
    expect(membership!.cadence).toBe('monthly');
    expect(membership!.cancelAtPeriodEnd).toBe(false);
    expect(membership!.baseAmountCents).toBe(BASE_PRICING.baseAmountCents);
    expect(membership!.devFeePercent).toBe(BASE_PRICING.devFeePercent);

    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { membershipId: membership!.id },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.providerInvoiceRef).toBe('in_test_001');
    expect(invoices[0]!.status).toBe('paid');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil?.toISOString()).toBe(new Date('2026-07-01').toISOString());

    const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(xpEvents).toHaveLength(1);
    expect(xpEvents[0]!.reason).toBe('premium_activation');
    expect(xpEvents[0]!.delta).toBe(200);
    expect(xpEvents[0]!.sourceRef).toBe(`garage:${gid}`);

    const updatedGarage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(updatedGarage.xp).toBe(200);
  });

  it('activated: max() rule — existing admin-grant premiumUntil beyond sub period is not clobbered', async () => {
    const { user } = await createUser({ email: 'am2@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Simulate admin grant pushing premiumUntil far into the future.
    const adminGrantUntil = new Date('2027-01-01');
    await prisma.garage.update({
      where: { id: gid },
      data: { premiumTier: 'gold', premiumUntil: adminGrantUntil },
    });

    const subPeriodEnd = new Date('2026-07-01'); // before the admin grant date
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(gid, {
          currentPeriodEnd: subPeriodEnd,
        }),
      );
    });

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    // max(adminGrantUntil=2027-01-01, subPeriodEnd=2026-07-01) = adminGrantUntil
    expect(garage.premiumUntil!.toISOString()).toBe(adminGrantUntil.toISOString());
  });

  it('activated: replay with same invoiceRef is idempotent — single invoice row', async () => {
    const { user } = await createUser({ email: 'am3@jdm.test', verified: true });
    const gid = await garageId(user.id);
    const evt = buildActivatedEvt(gid);

    // First activation.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evt);
    });

    // Second call with same invoiceRef (replay). Must not throw or insert a second invoice.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, evt);
    });

    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { providerInvoiceRef: 'in_test_001' },
    });
    expect(invoices).toHaveLength(1);
    // XP also still awarded only once.
    const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(xpEvents).toHaveLength(1);
  });

  it('renewed: updates period + inserts invoice + max() snapshot — no XP', async () => {
    const { user } = await createUser({ email: 'am4@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // First activate.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    // Renewal.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildRenewedEvt('sub_test001'));
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.currentPeriodEnd.toISOString()).toBe(new Date('2026-08-01').toISOString());

    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { membershipId: membership!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(invoices).toHaveLength(2);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumUntil!.toISOString()).toBe(new Date('2026-08-01').toISOString());

    // No XP on renewal.
    const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(xpEvents).toHaveLength(1); // still only the activation XP
  });

  it('cancelled: sets cancel_scheduled flag — no snapshot change', async () => {
    const { user } = await createUser({ email: 'am5@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    const garageBefore = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });

    const cancelledAt = new Date('2026-06-15');
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.cancelled',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
        cancelledAt,
      });
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.status).toBe('cancel_scheduled');
    expect(membership!.cancelAtPeriodEnd).toBe(true);
    expect(membership!.cancelledAt?.toISOString()).toBe(cancelledAt.toISOString());

    // Snapshot must be unchanged.
    const garageAfter = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garageAfter.premiumUntil?.toISOString()).toBe(garageBefore.premiumUntil?.toISOString());
  });

  it('uncancelled: clears flag + refreshes snapshot', async () => {
    const { user } = await createUser({ email: 'am6@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.cancelled',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
        cancelledAt: new Date('2026-06-15'),
      });
    });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.uncancelled',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
      });
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.status).toBe('active');
    expect(membership!.cancelAtPeriodEnd).toBe(false);
    expect(membership!.cancelledAt).toBeNull();

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();
  });

  it('expired: clears Garage snapshot when premiumUntil is past and no other live membership', async () => {
    const { user } = await createUser({ email: 'am7@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(gid, {
          currentPeriodEnd: new Date('2020-01-01'), // already in the past
        }),
      );
    });

    // Manually move premiumUntil into the past so the conditional clear fires.
    await prisma.garage.update({
      where: { id: gid },
      data: { premiumUntil: new Date('2020-01-01') },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.expired',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
        cancelledAt: new Date('2020-01-01'),
      });
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.status).toBe('expired');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();
  });

  it('expired: does NOT clear Garage snapshot when admin-grant premiumUntil is in the future', async () => {
    const { user } = await createUser({ email: 'am8@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(gid, {
          currentPeriodEnd: new Date('2020-01-01'),
        }),
      );
    });

    // Simulate admin-grant pushing premiumUntil to the future.
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
    await prisma.garage.update({
      where: { id: gid },
      data: { premiumUntil: futureDate },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.expired',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
        cancelledAt: new Date('2020-01-01'),
      });
    });

    // Snapshot must remain because admin grant extends beyond now.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil!.toISOString()).toBe(futureDate.toISOString());
  });

  it('past_due: flips status only — no snapshot change', async () => {
    const { user } = await createUser({ email: 'am9@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    const garageBefore = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.past_due',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
      });
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.status).toBe('past_due');

    const garageAfter = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garageAfter.premiumUntil?.toISOString()).toBe(garageBefore.premiumUntil?.toISOString());
    expect(garageAfter.premiumTier).toBe(garageBefore.premiumTier);
  });

  it('tier_changed: updates tier/cadence/pricing snapshot — no XP', async () => {
    const { user } = await createUser({ email: 'am10@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid, { cadence: 'monthly' }));
    });

    const ANNUAL_PRICING = {
      baseAmountCents: 29900,
      devFeePercent: 10,
      devFeeAmountCents: 2990,
      grossAmountCents: 32890,
      currency: 'BRL',
    };

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        kind: 'subscription.tier_changed',
        provider: 'stripe',
        providerSubRef: 'sub_test001',
        tier: 'gold',
        cadence: 'annual',
        pricing: ANNUAL_PRICING,
      });
    });

    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.cadence).toBe('annual');
    expect(membership!.grossAmountCents).toBe(ANNUAL_PRICING.grossAmountCents);

    // No additional XP — premium_activation is one-shot-ever.
    const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(xpEvents).toHaveLength(1);
  });

  it('applyInvoiceRefund: full refund flips invoice to refunded, membership unchanged', async () => {
    const { user } = await createUser({ email: 'am11@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    await prisma.$transaction(async (tx) => {
      await applyInvoiceRefund(tx, 'stripe', 'in_test_001', BASE_PRICING.grossAmountCents);
    });

    const invoice = await prisma.premiumMembershipInvoice.findFirst({
      where: { providerInvoiceRef: 'in_test_001' },
    });
    expect(invoice!.status).toBe('refunded');
    expect(invoice!.refundedAmountCents).toBe(BASE_PRICING.grossAmountCents);
    expect(invoice!.refundedAt).not.toBeNull();

    // Membership stays active (canon §F8.10).
    const membership = await prisma.premiumMembership.findFirst({ where: { garageId: gid } });
    expect(membership!.status).toBe('active');
  });

  it('applyInvoiceRefund: partial refund sets partial_refund status', async () => {
    const { user } = await createUser({ email: 'am12@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    await prisma.$transaction(async (tx) => {
      // Partial refund of half the gross amount.
      await applyInvoiceRefund(
        tx,
        'stripe',
        'in_test_001',
        Math.floor(BASE_PRICING.grossAmountCents / 2),
      );
    });

    const invoice = await prisma.premiumMembershipInvoice.findFirst({
      where: { providerInvoiceRef: 'in_test_001' },
    });
    expect(invoice!.status).toBe('partial_refund');
    expect(invoice!.refundedAmountCents).toBe(Math.floor(BASE_PRICING.grossAmountCents / 2));
  });

  it('concurrent activations for same garage: one wins, the other fails cleanly (P2002)', async () => {
    const { user } = await createUser({ email: 'am13@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Two different providerSubRefs but same garageId — this would produce two
    // live rows for the same garage, violating the partial unique index.
    const evtA = buildActivatedEvt(gid, {
      providerSubRef: 'sub_race_A',
      invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_race_A' },
    });
    const evtB = buildActivatedEvt(gid, {
      providerSubRef: 'sub_race_B',
      invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_race_B' },
    });

    const [resultA, resultB] = await Promise.allSettled([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
        await applyMembershipEvent(tx, evtA);
      }),
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
        await applyMembershipEvent(tx, evtB);
      }),
    ]);

    // Exactly one should succeed.
    const successes = [resultA, resultB].filter((r) => r.status === 'fulfilled');
    const failures = [resultA, resultB].filter((r) => r.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Only one live membership row for this garage.
    const liveMemberships = await prisma.premiumMembership.findMany({
      where: { garageId: gid, status: { in: ['active', 'past_due', 'cancel_scheduled'] } },
    });
    expect(liveMemberships).toHaveLength(1);

    // XP awarded exactly once.
    const xpEvents = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(xpEvents).toHaveLength(1);
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.xp).toBe(200);
  });

  it('canon §F8.6: awardXp called exactly once per activation tx', async () => {
    const { user } = await createUser({ email: 'am14@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // We spy on awardXp at the module level to count invocations.
    const awarderModule = await import('../../src/services/garage/xp-awarder.js');
    const spy = vi.spyOn(awarderModule, 'awardXp');

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(gid, {
          providerSubRef: 'sub_spy_test',
          invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_spy_001' },
        }),
      );
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.anything(), // TransactionClient
      gid,
      'premium_activation',
      expect.objectContaining({ sourceRef: `garage:${gid}`, delta: 200 }),
    );

    spy.mockRestore();
  });

  // -- out-of-order webhook regression guards --

  it('activated: stale replay does NOT regress membership.currentPeriodEnd', async () => {
    const { user } = await createUser({ email: 'am15@jdm.test', verified: true });
    const gid = await garageId(user.id);

    // Forward activation (period 06-01 → 07-01).
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });

    // Renewal advances the row to 08-01.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildRenewedEvt('sub_test001'));
    });

    const beforeStale = await prisma.premiumMembership.findFirstOrThrow({
      where: { garageId: gid },
    });
    expect(beforeStale.currentPeriodEnd.toISOString()).toBe(new Date('2026-08-01').toISOString());

    // Out-of-order: a delayed activation for the OLD period 06-01 → 07-01
    // arrives now. It must not push the membership row backward.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(gid, {
          invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_stale_001' },
        }),
      );
    });

    const after = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId: gid } });
    expect(after.currentPeriodEnd.toISOString()).toBe(new Date('2026-08-01').toISOString());
    expect(after.currentPeriodStart.toISOString()).toBe(
      beforeStale.currentPeriodStart.toISOString(),
    );
    expect(after.status).toBe('active');

    // Garage snapshot stays at the later date too.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.premiumUntil!.toISOString()).toBe(new Date('2026-08-01').toISOString());
  });

  it('renewed: stale replay does NOT regress membership.currentPeriodEnd', async () => {
    const { user } = await createUser({ email: 'am16@jdm.test', verified: true });
    const gid = await garageId(user.id);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, buildActivatedEvt(gid));
    });
    // Forward renewal pushes the row to 09-01.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        ...buildRenewedEvt('sub_test001'),
        currentPeriodStart: new Date('2026-08-01'),
        currentPeriodEnd: new Date('2026-09-01'),
        invoice: {
          ...BASE_INVOICE,
          providerInvoiceRef: 'in_renew_forward',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-09-01'),
        },
      });
    });

    // Stale renewal for the prior period 07-01 → 08-01 arrives now.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
      await applyMembershipEvent(tx, {
        ...buildRenewedEvt('sub_test001'),
        currentPeriodStart: new Date('2026-07-01'),
        currentPeriodEnd: new Date('2026-08-01'),
        invoice: {
          ...BASE_INVOICE,
          providerInvoiceRef: 'in_renew_stale',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-08-01'),
        },
      });
    });

    const after = await prisma.premiumMembership.findFirstOrThrow({ where: { garageId: gid } });
    expect(after.currentPeriodEnd.toISOString()).toBe(new Date('2026-09-01').toISOString());

    // Both invoices recorded as history (forward + stale).
    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { membershipId: after.id },
    });
    expect(invoices.map((i) => i.providerInvoiceRef).sort()).toEqual(
      ['in_renew_forward', 'in_renew_stale', 'in_test_001'].sort(),
    );

    // Garage snapshot stays at the later date.
    const g = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(g.premiumUntil!.toISOString()).toBe(new Date('2026-09-01').toISOString());
  });

  it('applyInvoiceRefund: refund on one provider does NOT touch the same ref on another provider', async () => {
    const { user: u1 } = await createUser({ email: 'am17a@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'am17b@jdm.test', verified: true });
    const stripeGid = await garageId(u1.id);
    const rcGid = await garageId(u2.id);

    // Stripe activation for garage 1 with invoice ref 'in_collide_001'.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${stripeGid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(stripeGid, {
          provider: 'stripe',
          providerSubRef: 'sub_collide_stripe',
          invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_collide_001' },
        }),
      );
    });

    // RevenueCat activation for garage 2 with the SAME providerInvoiceRef.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${rcGid} FOR UPDATE`;
      await applyMembershipEvent(
        tx,
        buildActivatedEvt(rcGid, {
          provider: 'apple_revenuecat',
          providerSubRef: 'sub_collide_rc',
          invoice: { ...BASE_INVOICE, providerInvoiceRef: 'in_collide_001' },
        }),
      );
    });

    // Refund the Stripe invoice only.
    await prisma.$transaction(async (tx) => {
      await applyInvoiceRefund(tx, 'stripe', 'in_collide_001', BASE_PRICING.grossAmountCents);
    });

    const stripeInvoice = await prisma.premiumMembershipInvoice.findUniqueOrThrow({
      where: {
        provider_providerInvoiceRef: { provider: 'stripe', providerInvoiceRef: 'in_collide_001' },
      },
    });
    expect(stripeInvoice.status).toBe('refunded');

    // RC row must remain untouched.
    const rcInvoice = await prisma.premiumMembershipInvoice.findUniqueOrThrow({
      where: {
        provider_providerInvoiceRef: {
          provider: 'apple_revenuecat',
          providerInvoiceRef: 'in_collide_001',
        },
      },
    });
    expect(rcInvoice.status).toBe('paid');
    expect(rcInvoice.refundedAt).toBeNull();
    expect(rcInvoice.refundedAmountCents).toBeNull();
  });
});
