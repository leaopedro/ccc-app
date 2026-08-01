import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyMembershipEvent,
  enqueuePremiumTicketBackfillIfActivated,
} from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, resetDatabase } from '../helpers.js';

// Mirrors the canon §F8.4/§F8.5 caller contract used by webhook routes:
//   1. open tx
//   2. SELECT FOR UPDATE on Garage
//   3. applyMembershipEvent(tx, evt)
//   4. commit
//   5. POST-COMMIT: enqueuePremiumTicketBackfillIfActivated(prisma, evt)
const dispatch = async (evt: BillingEvent, garageIdForLock: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${garageIdForLock} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });
  await enqueuePremiumTicketBackfillIfActivated(prisma, evt);
};

const BASE_PRICING = {
  baseAmountCents: 2900,
  devFeePercent: 10,
  devFeeAmountCents: 290,
  grossAmountCents: 3190,
  currency: 'BRL',
};

const BASE_INVOICE = {
  providerInvoiceRef: 'in_test_enqueue_001',
  periodStart: new Date('2026-06-01'),
  periodEnd: new Date('2026-07-01'),
  paidAt: new Date('2026-06-01'),
};

const makeActivatedEvent = (
  garageId: string,
  overrides: Partial<Extract<BillingEvent, { kind: 'subscription.activated' }>> = {},
): Extract<BillingEvent, { kind: 'subscription.activated' }> => ({
  kind: 'subscription.activated',
  provider: 'stripe',
  providerCustomerRef: 'cus_test_enq',
  providerSubRef: 'sub_test_enq_001',
  garageId,
  tier: 'gold',
  cadence: 'monthly',
  currentPeriodStart: new Date('2026-06-01'),
  currentPeriodEnd: new Date('2026-07-01'),
  pricing: BASE_PRICING,
  invoice: BASE_INVOICE,
  lines: [],
  addons: [],
  addonsAmountCents: 0,
  ...overrides,
});

describe('enqueuePremiumTicketBackfillIfActivated', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('enqueues exactly one PremiumTicketBackfillJob after subscription.activated commits', async () => {
    const { user } = await createUser({ email: 'enqueue-test@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    await dispatch(makeActivatedEvent(garage.id), garage.id);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('pending');
  });

  it('does NOT enqueue a backfill job for subscription.renewed', async () => {
    const { user } = await createUser({
      email: 'no-enqueue-renewed@jdm.test',
      verified: true,
    });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Activate first to create the membership row, then clear the activation job
    // so we can assert renewal does not re-enqueue.
    await dispatch(makeActivatedEvent(garage.id), garage.id);
    await prisma.premiumTicketBackfillJob.deleteMany({ where: { garageId: garage.id } });

    const renewed: BillingEvent = {
      kind: 'subscription.renewed',
      provider: 'stripe',
      providerSubRef: 'sub_test_enq_001',
      currentPeriodStart: new Date('2026-07-01'),
      currentPeriodEnd: new Date('2026-08-01'),
      pricing: BASE_PRICING,
      invoice: {
        providerInvoiceRef: 'in_test_renewal_001',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-08-01'),
        paidAt: new Date('2026-07-01'),
      },
      lines: [],
    };

    await dispatch(renewed, garage.id);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    // Canon §4.3: renewal does NOT trigger backfill.
    expect(jobs).toHaveLength(0);
  });

  it('enqueues one job per activated dispatch (idempotency is owned by upstream webhook dedup, not this helper)', async () => {
    // The webhook routes guard against re-delivery via SubscriptionWebhookEvent
    // unique (provider, providerEventId). The enqueue helper itself only
    // checks event.kind. This test pins that contract: the helper trusts the
    // caller to invoke it once per committed activation.
    const { user } = await createUser({ email: 'enqueue-once@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const evt = makeActivatedEvent(garage.id);
    await dispatch(evt, garage.id);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs).toHaveLength(1);
  });

  it('does NOT enqueue for non-activation kinds (cancelled, expired, past_due, tier_changed, uncancelled)', async () => {
    const { user } = await createUser({ email: 'no-enqueue-other@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Seed a membership row so the non-activation handlers do not fail on
    // findUniqueOrThrow. Activate first, then clear any backfill jobs.
    await dispatch(makeActivatedEvent(garage.id), garage.id);
    await prisma.premiumTicketBackfillJob.deleteMany({ where: { garageId: garage.id } });

    // Helper only — directly call the enqueue with non-activation events to
    // pin that no row is created. We don't run applyMembershipEvent for these
    // because some kinds require complex prerequisite state; the assertion
    // here is purely about the enqueue gate.
    const cancelled: BillingEvent = {
      kind: 'subscription.cancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test_enq_001',
      cancelledAt: new Date(),
    };
    await enqueuePremiumTicketBackfillIfActivated(prisma, cancelled);

    const expired: BillingEvent = {
      kind: 'subscription.expired',
      provider: 'stripe',
      providerSubRef: 'sub_test_enq_001',
      cancelledAt: new Date(),
    };
    await enqueuePremiumTicketBackfillIfActivated(prisma, expired);

    const pastDue: BillingEvent = {
      kind: 'subscription.past_due',
      provider: 'stripe',
      providerSubRef: 'sub_test_enq_001',
    };
    await enqueuePremiumTicketBackfillIfActivated(prisma, pastDue);

    const uncancelled: BillingEvent = {
      kind: 'subscription.uncancelled',
      provider: 'stripe',
      providerSubRef: 'sub_test_enq_001',
    };
    await enqueuePremiumTicketBackfillIfActivated(prisma, uncancelled);

    const tierChanged: BillingEvent = {
      kind: 'subscription.tier_changed',
      provider: 'stripe',
      providerSubRef: 'sub_test_enq_001',
      priceRef: 'price_test_enq_annual_gold',
      priceMetadata: { devFeePercent: '10' },
      tier: 'gold',
      cadence: 'annual',
      pricing: BASE_PRICING,
    };
    await enqueuePremiumTicketBackfillIfActivated(prisma, tierChanged);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs).toHaveLength(0);
  });
});
