import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RevenueCatClient } from '../../src/services/revenuecat/client.js';
import type { StripeClient } from '../../src/services/stripe/index.js';
import { runReconcileTick, type ReconcileTickDeps } from '../../src/workers/billing-reconcile.js';
import { createUser, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seedCounter = 0;
const nextEmail = () => {
  seedCounter += 1;
  return `rectest-${Date.now()}-${seedCounter}@jdm.test`;
};

/** Build a minimal PremiumMembership row + Garage seed in the test DB. */
async function seedMembership(overrides: {
  status: 'active' | 'past_due' | 'cancel_scheduled';
  provider: 'stripe' | 'apple_revenuecat';
  providerSubRef: string;
  providerCustomerRef: string;
  currentPeriodEnd: Date;
}) {
  const { user } = await createUser({ email: nextEmail(), verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

  const past = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
  const membership = await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: overrides.provider,
      providerCustomerRef: overrides.providerCustomerRef,
      providerSubRef: overrides.providerSubRef,
      tier: 'gold',
      cadence: 'monthly',
      status: overrides.status,
      currentPeriodStart: new Date(past.getTime() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: overrides.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 2990,
      currency: 'BRL',
    },
  });

  // Update Garage snapshot to reflect active membership
  await prisma.garage.update({
    where: { id: garage.id },
    data: { premiumTier: 'gold', premiumUntil: overrides.currentPeriodEnd },
  });

  return { membership, garageId: garage.id };
}

/**
 * Stripe SDK 2026-04-22 dahlia: `current_period_end` lives on
 * `SubscriptionItem`, not on the `Subscription` root. The mock matches.
 */
const makeStripeMock = (
  subStatus: string,
  newPeriodEnd: number,
  priceMetadata: Record<string, string> = { baseAmountCents: '2990', devFeePercent: '10' },
): StripeClient =>
  ({
    retrieveSubscription: vi.fn().mockResolvedValue({
      id: 'sub_test',
      status: subStatus,
      cancel_at_period_end: false,
      canceled_at: null,
      customer: 'cus_test',
      items: {
        data: [
          {
            current_period_end: newPeriodEnd,
            current_period_start: newPeriodEnd - 30 * 24 * 60 * 60,
            price: {
              id: 'price_monthly',
              metadata: priceMetadata,
              currency: 'brl',
              recurring: { interval: 'month' },
              product: { id: 'prod_gold' },
            },
          },
        ],
      },
    }),
    createPaymentIntent: vi.fn(),
    createCheckoutSession: vi.fn(),
    getCheckoutSessionPaymentIntentId: vi.fn(),
    constructWebhookEvent: vi.fn(),
    refund: vi.fn(),
    cancelPaymentIntent: vi.fn(),
    retrievePaymentIntent: vi.fn(),
    publishableKey: vi.fn().mockReturnValue('pk_test'),
  }) as unknown as StripeClient;

const makeRcMock = (expiresDate: string | null): RevenueCatClient =>
  ({
    getSubscriber: vi.fn().mockResolvedValue({
      entitlements: {
        premium_gold: {
          expiresDate,
          productIdentifier: 'jdm_premium_monthly',
          purchaseDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      subscriptions: {},
    }),
  }) as unknown as RevenueCatClient;

const buildLog = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
  level: 'info' as const,
  silent: vi.fn(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runReconcileTick', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  it('no-op when no stale memberships exist', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_future',
      providerCustomerRef: 'cus_future',
      currentPeriodEnd: future,
    });

    const stripe = makeStripeMock('active', Math.floor(future.getTime() / 1000));
    const rc = makeRcMock(future.toISOString());
    const log = buildLog();
    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
    };

    await runReconcileTick(deps);

    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(rc.getSubscriber).not.toHaveBeenCalled();
  });

  it('Stripe: recovers missed renewal — updates membership period + Garage snapshot', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000); // 30min ago
    const { membership, garageId } = await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_drifted',
      providerCustomerRef: 'cus_drifted',
      currentPeriodEnd: staleEnd,
    });

    const newPeriodEndUnix = Math.floor((Date.now() + 29 * 24 * 60 * 60 * 1000) / 1000);
    const stripe = makeStripeMock('active', newPeriodEndUnix);
    const rc = makeRcMock(null);
    const log = buildLog();

    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
    };
    await runReconcileTick(deps);

    expect(stripe.retrieveSubscription).toHaveBeenCalledWith('sub_drifted');

    const updated = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(updated.status).toBe('active');
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(staleEnd.getTime());

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();
    expect(garage.premiumUntil!.getTime()).toBeGreaterThan(staleEnd.getTime());

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reconcile.recovered',
        provider: 'stripe',
        membershipId: membership.id,
      }),
      expect.any(String),
    );
  });

  it('Stripe: reconcile-synthesised invoice stores gross = base + devFee (canon §F8.1)', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000);
    const { membership } = await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_gross_check',
      providerCustomerRef: 'cus_gross_check',
      currentPeriodEnd: staleEnd,
    });

    const newPeriodEndUnix = Math.floor((Date.now() + 29 * 24 * 60 * 60 * 1000) / 1000);
    const stripe = makeStripeMock('active', newPeriodEndUnix);
    const rc = makeRcMock(null);
    const log = buildLog();

    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
    };
    await runReconcileTick(deps);

    // baseAmountCents=2990, devFeePercent=10 → devFeeAmountCents=299 → gross=3289
    const invoice = await prisma.premiumMembershipInvoice.findFirstOrThrow({
      where: { membershipId: membership.id },
    });
    expect(invoice.baseAmountCents).toBe(2990);
    expect(invoice.devFeePercent).toBe(10);
    expect(invoice.devFeeAmountCents).toBe(299);
    expect(invoice.grossAmountCents).toBe(2990 + 299);
    expect(invoice.grossAmountCents).toBe(invoice.baseAmountCents + invoice.devFeeAmountCents);
  });

  it('Stripe: accepts valid 0 metadata (devFeePercent="0") instead of falling back to row snapshot', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000);
    const { membership } = await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_zero_fee',
      providerCustomerRef: 'cus_zero_fee',
      currentPeriodEnd: staleEnd,
    });

    const newPeriodEndUnix = Math.floor((Date.now() + 29 * 24 * 60 * 60 * 1000) / 1000);
    // Free-promo price: devFeePercent='0' is a valid value, NOT missing.
    const stripe = makeStripeMock('active', newPeriodEndUnix, {
      baseAmountCents: '2990',
      devFeePercent: '0',
    });
    const rc = makeRcMock(null);
    const log = buildLog();

    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
    };
    await runReconcileTick(deps);

    const invoice = await prisma.premiumMembershipInvoice.findFirstOrThrow({
      where: { membershipId: membership.id },
    });
    // Must use the provider value (0), NOT the row snapshot (10).
    expect(invoice.devFeePercent).toBe(0);
    expect(invoice.devFeeAmountCents).toBe(0);
    expect(invoice.grossAmountCents).toBe(2990);
  });

  it('Stripe: transitions to expired + clears Garage snapshot when sub is canceled', async () => {
    const staleEnd = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const { membership, garageId } = await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_canceled',
      providerCustomerRef: 'cus_canceled',
      currentPeriodEnd: staleEnd,
    });

    const stripe = makeStripeMock('canceled', Math.floor(staleEnd.getTime() / 1000));
    const rc = makeRcMock(null);
    const log = buildLog();

    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
    };
    await runReconcileTick(deps);

    const expired = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(expired.status).toBe('expired');

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBeNull();
    expect(garage.premiumUntil).toBeNull();

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reconcile.expired',
        provider: 'stripe',
        membershipId: membership.id,
      }),
      expect.any(String),
    );
  });

  it('RC: recovers missed renewal when entitlement still valid in RevenueCat', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000); // 30min ago
    const { membership, garageId } = await seedMembership({
      status: 'active',
      provider: 'apple_revenuecat',
      providerSubRef: 'entitlement_premium_gold',
      providerCustomerRef: 'garage_rc_user_1',
      currentPeriodEnd: staleEnd,
    });

    const newExpiry = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    const rc = makeRcMock(newExpiry.toISOString());
    const stripe = makeStripeMock('canceled', 0);
    const log = buildLog();

    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
    };
    await runReconcileTick(deps);

    expect(rc.getSubscriber).toHaveBeenCalledWith('garage_rc_user_1');

    const updated = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(updated.status).toBe('active');
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(staleEnd.getTime());

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: garageId } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).not.toBeNull();

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reconcile.recovered',
        provider: 'apple_revenuecat',
        membershipId: membership.id,
      }),
      expect.any(String),
    );
  });

  it('emits structured alert when stale row count equals alertDepth threshold', async () => {
    const staleEnd = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_alert_1',
      providerCustomerRef: 'cus_alert_1',
      currentPeriodEnd: staleEnd,
    });
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_alert_2',
      providerCustomerRef: 'cus_alert_2',
      currentPeriodEnd: staleEnd,
    });

    const stripe = makeStripeMock('canceled', Math.floor(staleEnd.getTime() / 1000));
    const rc = makeRcMock(null);
    const log = buildLog();

    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 2,
      log: log as unknown as FastifyBaseLogger,
    };
    await runReconcileTick(deps);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reconcile.queue_depth_alert', depth: 2, alertDepth: 2 }),
      expect.any(String),
    );
  });

  it('flag disabled (GROWTH_PREMIUM_BILLING_ENABLED=false) — tick exits without provider calls', async () => {
    const staleEnd = new Date(Date.now() - 30 * 60 * 1000);
    await seedMembership({
      status: 'active',
      provider: 'stripe',
      providerSubRef: 'sub_flagoff',
      providerCustomerRef: 'cus_flagoff',
      currentPeriodEnd: staleEnd,
    });

    const stripe = makeStripeMock('active', Math.floor(Date.now() / 1000) + 86400);
    const rc = makeRcMock(null);
    const log = buildLog();
    const deps: ReconcileTickDeps = {
      stripe,
      rc,
      alertDepth: 200,
      log: log as unknown as FastifyBaseLogger,
      flagEnabled: false,
    };

    await runReconcileTick(deps);

    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
    expect(rc.getSubscriber).not.toHaveBeenCalled();
  });
});
