/**
 * `subscription.renewed` (forward branch) and `subscription.resumed` onto a row
 * that is NOT live while a DIFFERENT row for the same garage IS.
 *
 * PR #44 closed this door for `subscription.activated` and deliberately left it
 * open here, with the reasoning written into handleRenewed. Both handlers write
 * `status: 'active'`, so both can move a second row into
 * `premium_membership_live_per_garage` (migration 20260527094120, lines
 * 109-111) and raise the same uncaught P2002 — the webhook 5xx's and the
 * provider retries the identical violation forever.
 *
 * The two reachable sequences, both of them consequences of decisions PR #44
 * made on purpose:
 *
 *   renewed — normalize-revenuecat keys providerSubRef on
 *     `original_transaction_id`, which Apple reuses across re-purchases. An
 *     expired Apple row + a live Stripe row is exactly what PR #44's guard
 *     LEAVES BEHIND when it refuses the Apple re-purchase: Apple keeps billing
 *     the refused subscription, and its next RENEWAL lands on the still-expired
 *     row. The row exists, so the route's unknown-subscription branch does not
 *     catch it; handleRenewed does, and flips it live.
 *
 *   resumed — `paused` sits inside LIVE_MEMBERSHIP_STATUSES but OUTSIDE the
 *     index, and PR #44 deliberately scoped its guard to the index so a member
 *     with a paused Stripe subscription can still buy on Apple. That is the
 *     right call, and it is precisely what creates a paused row next to a live
 *     one. Clearing pause_collection in the Billing Portal then asks us to make
 *     the paused row active.
 */

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => {
  const noop = () => {};
  return {
    init: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: (
      cb: (scope: {
        setTag: typeof noop;
        setLevel: typeof noop;
        setExtras: typeof noop;
        setExtra: typeof noop;
        setContext: typeof noop;
      }) => void,
    ) => cb({ setTag: noop, setLevel: noop, setExtras: noop, setExtra: noop, setContext: noop }),
  };
});

const Sentry = (await import('@sentry/node')) as unknown as {
  captureMessage: ReturnType<typeof vi.fn>;
};

import { applyMembershipEvent } from '../../src/services/billing/apply-membership-event.js';
import type { BillingEvent } from '../../src/services/billing/types.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

const apply = async (evt: BillingEvent, gid: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${gid} FOR UPDATE`;
    await applyMembershipEvent(tx, evt);
  });
};

const seedMembership = (
  gid: string,
  overrides: Partial<Parameters<typeof prisma.premiumMembership.create>[0]['data']> = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId: gid,
      provider: 'stripe',
      providerCustomerRef: 'cus_seed',
      providerSubRef: 'sub_seed',
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-06-01'),
      currentPeriodEnd: new Date('2026-07-01'),
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
      ...overrides,
    } as Parameters<typeof prisma.premiumMembership.create>[0]['data'],
  });

const conflictAlerts = () =>
  Sentry.captureMessage.mock.calls.filter(
    (c: unknown[]) =>
      (c[1] as { tags?: { kind?: string } } | undefined)?.tags?.kind ===
      'premium-live-membership-conflict',
  );

describe('applyMembershipEvent: renewed/resumed onto a non-live row beside a live one', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    Sentry.captureMessage.mockClear();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('renewed: does not raise P2002 and leaves the incumbent live', async () => {
    const { user } = await createUser({ email: 'renew-conflict@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    // The Apple row PR #44's guard refused and left expired.
    const appleRow = await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_txn_renew',
      status: 'expired',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 2990,
    });
    // The Stripe subscription that won.
    const stripeRow = await seedMembership(gid, { providerSubRef: 'sub_renew_incumbent' });

    // Apple bills the refused subscription anyway. RENEWAL, forward period.
    await apply(
      {
        kind: 'subscription.renewed',
        provider: 'apple_revenuecat',
        providerSubRef: 'orig_txn_renew',
        currentPeriodStart: new Date('2026-09-01'),
        currentPeriodEnd: new Date('2026-10-01'),
        pricing: {
          baseAmountCents: 2990,
          devFeePercent: 0,
          devFeeAmountCents: 0,
          grossAmountCents: 2990,
          currency: 'BRL',
        },
        invoice: {
          providerInvoiceRef: 'in_renew_apple',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-10-01'),
          paidAt: new Date('2026-09-01T10:00:00.000Z'),
        },
        lines: [],
      },
      gid,
    );

    // The incumbent keeps the index slot; the renewing row stays out of it.
    const apple = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: appleRow.id } });
    expect(apple.status).toBe('expired');
    const stripe = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: stripeRow.id },
    });
    expect(stripe.status).toBe('active');

    // The money still lands, filed under the subscription that was paid for.
    const invoices = await prisma.premiumMembershipInvoice.findMany();
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.providerInvoiceRef).toBe('in_renew_apple');
    expect(invoices[0]!.membershipId).toBe(appleRow.id);

    expect(conflictAlerts()).toHaveLength(1);
  });

  it('resumed: does not raise P2002 and leaves the paused row paused', async () => {
    const { user } = await createUser({ email: 'resume-conflict@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const pausedRow = await seedMembership(gid, {
      providerSubRef: 'sub_resume_paused',
      status: 'paused',
    });
    const appleRow = await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_txn_resume_live',
      status: 'active',
    });

    await apply(
      { kind: 'subscription.resumed', provider: 'stripe', providerSubRef: 'sub_resume_paused' },
      gid,
    );

    const paused = await prisma.premiumMembership.findUniqueOrThrow({
      where: { id: pausedRow.id },
    });
    expect(paused.status).toBe('paused');
    const apple = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: appleRow.id } });
    expect(apple.status).toBe('active');

    expect(conflictAlerts()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Renewal: the alert, and the deliberate asymmetry with handleActivated
  // -------------------------------------------------------------------------

  it('renewed: keeps the invoice and the period, refuses only the status flip', async () => {
    const { user } = await createUser({ email: 'renew-partial@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const loser = await seedMembership(gid, {
      providerSubRef: 'sub_partial_loser',
      status: 'expired',
      baseAmountCents: 1000,
      grossAmountCents: 1000,
      devFeePercent: 0,
      devFeeAmountCents: 0,
    });
    await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_partial_incumbent',
    });
    await prisma.garage.update({
      where: { id: gid },
      data: { premiumTier: 'gold', premiumUntil: new Date('2026-07-01') },
    });

    await apply(
      {
        kind: 'subscription.renewed',
        provider: 'stripe',
        providerSubRef: 'sub_partial_loser',
        currentPeriodStart: new Date('2026-09-01'),
        currentPeriodEnd: new Date('2026-10-01'),
        pricing: {
          baseAmountCents: 5000,
          devFeePercent: 10,
          devFeeAmountCents: 500,
          grossAmountCents: 5500,
          currency: 'BRL',
        },
        invoice: {
          providerInvoiceRef: 'in_partial',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-10-01'),
          paidAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        lines: [],
      },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: loser.id } });
    // Refused.
    expect(row.status).toBe('expired');
    // Applied — the invoice we just filed under this row has to agree with it.
    expect(row.currentPeriodEnd).toEqual(new Date('2026-10-01'));
    expect(row.baseAmountCents).toBe(5000);
    expect(row.grossAmountCents).toBe(5500);

    // The payment is in the books, under the subscription that was paid for.
    const invoice = await prisma.premiumMembershipInvoice.findFirstOrThrow({
      where: { providerInvoiceRef: 'in_partial' },
    });
    expect(invoice.membershipId).toBe(loser.id);
    expect(invoice.grossAmountCents).toBe(5500);

    // Entitlement did NOT follow. A row that is not live does not move the
    // snapshot, even though the member did pay for the period.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumUntil).toEqual(new Date('2026-07-01'));
  });

  it('renewed: alert says the money landed and the entitlement did not', async () => {
    const { user } = await createUser({ email: 'renew-alert@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const loser = await seedMembership(gid, {
      providerSubRef: 'sub_alert_loser',
      status: 'expired',
    });
    const incumbent = await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_alert_incumbent',
      status: 'cancel_scheduled',
    });

    await apply(
      {
        kind: 'subscription.renewed',
        provider: 'stripe',
        providerSubRef: 'sub_alert_loser',
        currentPeriodStart: new Date('2026-09-01'),
        currentPeriodEnd: new Date('2026-10-01'),
        pricing: {
          baseAmountCents: 2990,
          devFeePercent: 10,
          devFeeAmountCents: 299,
          grossAmountCents: 3289,
          currency: 'BRL',
        },
        invoice: {
          providerInvoiceRef: 'in_alert',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-10-01'),
          paidAt: new Date('2026-09-01T08:30:00.000Z'),
        },
        lines: [],
      },
      gid,
    );

    const [call] = conflictAlerts();
    expect(call).toBeDefined();
    const opts = call![1] as { level: string; extra: Record<string, unknown> };
    expect(opts.level).toBe('error');
    expect(call![0]).toContain('renewal paid but not activated');
    expect(opts.extra).toMatchObject({
      garageId: gid,
      eventKind: 'subscription.renewed',
      memberWasCharged: true,
      incumbentMembershipId: incumbent.id,
      incumbentProviderSubRef: 'orig_alert_incumbent',
      incumbentStatus: 'cancel_scheduled',
      incomingMembershipId: loser.id,
      incomingMembershipStatus: 'expired',
      incomingProviderSubRef: 'sub_alert_loser',
      incomingGrossAmountCents: 3289,
      // Recorded, unlike the activation alert's `unrecorded*` keys. The
      // operator refunding the duplicate must know it is already filed.
      recordedProviderInvoiceRef: 'in_alert',
      recordedPaidAt: new Date('2026-09-01T08:30:00.000Z').toISOString(),
      statusFlipRefused: true,
      garageSnapshotRefused: true,
    });
  });

  it('renewed: a stale renewal writes no status, so it must not alert', async () => {
    const { user } = await createUser({ email: 'renew-stale@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    await seedMembership(gid, {
      providerSubRef: 'sub_stale_loser',
      status: 'expired',
      currentPeriodEnd: new Date('2026-12-01'),
    });
    await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_stale_incumbent',
    });

    await apply(
      {
        kind: 'subscription.renewed',
        provider: 'stripe',
        providerSubRef: 'sub_stale_loser',
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date('2026-07-01'),
        pricing: {
          baseAmountCents: 2990,
          devFeePercent: 10,
          devFeeAmountCents: 299,
          grossAmountCents: 3289,
          currency: 'BRL',
        },
        invoice: {
          providerInvoiceRef: 'in_stale',
          periodStart: new Date('2026-06-01'),
          periodEnd: new Date('2026-07-01'),
          paidAt: new Date('2026-06-01'),
        },
        lines: [],
      },
      gid,
    );

    expect(conflictAlerts()).toHaveLength(0);
    // The stale invoice still lands, exactly as before this change.
    expect(
      await prisma.premiumMembershipInvoice.count({ where: { providerInvoiceRef: 'in_stale' } }),
    ).toBe(1);
  });

  it('renewed: the ordinary renewal of the live row is untouched', async () => {
    const { user } = await createUser({ email: 'renew-happy@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const row = await seedMembership(gid, { providerSubRef: 'sub_happy' });

    await apply(
      {
        kind: 'subscription.renewed',
        provider: 'stripe',
        providerSubRef: 'sub_happy',
        currentPeriodStart: new Date('2026-07-01'),
        currentPeriodEnd: new Date('2026-08-01'),
        pricing: {
          baseAmountCents: 2990,
          devFeePercent: 10,
          devFeeAmountCents: 299,
          grossAmountCents: 3289,
          currency: 'BRL',
        },
        invoice: {
          providerInvoiceRef: 'in_happy',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-08-01'),
          paidAt: new Date('2026-07-01'),
        },
        lines: [],
      },
      gid,
    );

    const after = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('active');
    expect(after.currentPeriodEnd).toEqual(new Date('2026-08-01'));
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumUntil).toEqual(new Date('2026-08-01'));
    expect(conflictAlerts()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Resume: refuse everything, because there is nothing to salvage
  // -------------------------------------------------------------------------

  it('resumed: refuses the whole event and does not move the garage snapshot', async () => {
    const { user } = await createUser({ email: 'resume-whole@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const paused = await seedMembership(gid, {
      providerSubRef: 'sub_whole_paused',
      status: 'paused',
      tier: 'silver',
      cancelAtPeriodEnd: true,
      cancelledAt: new Date('2026-06-15'),
      currentPeriodEnd: new Date('2027-01-01'),
    });
    await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_whole_incumbent',
    });
    await prisma.garage.update({
      where: { id: gid },
      data: { premiumTier: 'gold', premiumUntil: new Date('2026-07-01') },
    });

    await apply(
      { kind: 'subscription.resumed', provider: 'stripe', providerSubRef: 'sub_whole_paused' },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: paused.id } });
    expect(row.status).toBe('paused');
    // Nothing half-written: the cancel flags this handler normally clears stay.
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.cancelledAt).not.toBeNull();

    // The refused row's far-future period must not leak into entitlement.
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.premiumTier).toBe('gold');
    expect(garage.premiumUntil).toEqual(new Date('2026-07-01'));
  });

  it('resumed: alert says no charge yet and the provider resumed billing anyway', async () => {
    const { user } = await createUser({ email: 'resume-alert@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const paused = await seedMembership(gid, {
      providerSubRef: 'sub_ra_paused',
      status: 'paused',
      tier: 'silver',
    });
    const incumbent = await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_ra_incumbent',
    });

    await apply(
      { kind: 'subscription.resumed', provider: 'stripe', providerSubRef: 'sub_ra_paused' },
      gid,
    );

    const [call] = conflictAlerts();
    const opts = call![1] as { level: string; extra: Record<string, unknown> };
    // No money moved in this event, but the next cycle will double-charge.
    expect(opts.level).toBe('error');
    expect(opts.extra).toMatchObject({
      garageId: gid,
      eventKind: 'subscription.resumed',
      memberWasCharged: false,
      providerResumedBilling: true,
      incumbentMembershipId: incumbent.id,
      incomingMembershipId: paused.id,
      incomingMembershipStatus: 'paused',
      incomingTier: 'silver',
      statusFlipRefused: true,
      garageSnapshotRefused: true,
    });
  });

  it('resumed: the ordinary resume with no other live row still works', async () => {
    const { user } = await createUser({ email: 'resume-happy@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    const paused = await seedMembership(gid, {
      providerSubRef: 'sub_resume_happy',
      status: 'paused',
    });
    // Another row for the same garage, but expired — outside the index.
    await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_resume_dead',
      status: 'expired',
    });

    await apply(
      { kind: 'subscription.resumed', provider: 'stripe', providerSubRef: 'sub_resume_happy' },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: paused.id } });
    expect(row.status).toBe('active');
    expect(conflictAlerts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The audit of the remaining status writers.
//
// PR #44 reported handleCancelled, handlePastDue, handleExpired, handlePaused,
// handleUncancelled, handleTierChanged and reconcileMembershipAddonsAmount as
// safe. Three of those seven are not: `cancel_scheduled`, `past_due` and
// `active` are all INSIDE premium_membership_live_per_garage, so all three
// writes can move a row into it. Each of the three below threw
// `Unique constraint failed on the fields: (garageId)` before this change.
//
// The four genuinely safe ones are here too, as the control: they must keep
// working with no alert. tier_changed and the addons reconcile write no status;
// expired and paused write statuses OUTSIDE the index, so they only ever leave
// it, which a partial unique never refuses.
// ---------------------------------------------------------------------------

describe('applyMembershipEvent: the other status writers, audited', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    Sentry.captureMessage.mockClear();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Target row outside the index, incumbent inside it. */
  const conflicted = async (email: string, targetStatus: 'paused' | 'expired') => {
    const { user } = await createUser({ email, verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;
    const target = await seedMembership(gid, {
      providerSubRef: 'sub_audit_target',
      status: targetStatus,
    });
    const incumbent = await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_audit_incumbent',
    });
    return { gid, target, incumbent };
  };

  it('cancelled: exposed — leaves the row paused and alerts', async () => {
    const { gid, target, incumbent } = await conflicted('audit-cancel@jdm.test', 'paused');

    await apply(
      {
        kind: 'subscription.cancelled',
        provider: 'stripe',
        providerSubRef: 'sub_audit_target',
        cancelledAt: new Date('2026-08-20'),
      },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe('paused');
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(row.cancelledAt).toBeNull();

    const [call] = conflictAlerts();
    expect((call![1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      eventKind: 'subscription.cancelled',
      memberWasCharged: false,
      attemptedStatus: 'cancel_scheduled',
      incumbentMembershipId: incumbent.id,
      incomingMembershipId: target.id,
      incomingMembershipStatus: 'paused',
      statusFlipRefused: true,
    });
  });

  it('past_due: exposed — leaves the row paused and alerts', async () => {
    const { gid, target } = await conflicted('audit-pastdue@jdm.test', 'paused');

    await apply(
      { kind: 'subscription.past_due', provider: 'stripe', providerSubRef: 'sub_audit_target' },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe('paused');
    const [call] = conflictAlerts();
    expect((call![1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      eventKind: 'subscription.past_due',
      attemptedStatus: 'past_due',
    });
  });

  it('uncancelled: exposed — leaves the row expired and alerts', async () => {
    const { gid, target } = await conflicted('audit-uncancel@jdm.test', 'expired');

    await apply(
      { kind: 'subscription.uncancelled', provider: 'stripe', providerSubRef: 'sub_audit_target' },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe('expired');
    const [call] = conflictAlerts();
    expect((call![1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      eventKind: 'subscription.uncancelled',
      attemptedStatus: 'active',
    });
  });

  it('cancelled/past_due/uncancelled: unaffected when no other row is live', async () => {
    const { user } = await createUser({ email: 'audit-clean@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;
    const row = await seedMembership(gid, { providerSubRef: 'sub_clean' });

    await apply(
      {
        kind: 'subscription.cancelled',
        provider: 'stripe',
        providerSubRef: 'sub_clean',
        cancelledAt: new Date('2026-08-20'),
      },
      gid,
    );
    expect(
      (await prisma.premiumMembership.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('cancel_scheduled');

    await apply(
      { kind: 'subscription.uncancelled', provider: 'stripe', providerSubRef: 'sub_clean' },
      gid,
    );
    expect(
      (await prisma.premiumMembership.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('active');

    await apply(
      { kind: 'subscription.past_due', provider: 'stripe', providerSubRef: 'sub_clean' },
      gid,
    );
    expect(
      (await prisma.premiumMembership.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('past_due');

    expect(conflictAlerts()).toHaveLength(0);
  });

  it('tier_changed: safe — writes no status, applies beside a live row', async () => {
    const { gid, target } = await conflicted('audit-tier@jdm.test', 'paused');

    await apply(
      {
        kind: 'subscription.tier_changed',
        provider: 'stripe',
        providerSubRef: 'sub_audit_target',
        priceRef: 'price_audit',
        priceMetadata: {},
        tier: 'silver',
        cadence: 'annual',
        pricing: {
          baseAmountCents: 9900,
          devFeePercent: 0,
          devFeeAmountCents: 0,
          grossAmountCents: 9900,
          currency: 'BRL',
        },
      },
      gid,
    );

    const row = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.tier).toBe('silver');
    // Untouched: the whole reason this handler needs no guard.
    expect(row.status).toBe('paused');
    expect(conflictAlerts()).toHaveLength(0);
  });

  it('expired and paused: safe — they only ever leave the index', async () => {
    const { gid, incumbent } = await conflicted('audit-leave@jdm.test', 'expired');

    await apply(
      {
        kind: 'subscription.paused',
        provider: 'apple_revenuecat',
        providerSubRef: incumbent.providerSubRef,
      },
      gid,
    );
    expect(
      (await prisma.premiumMembership.findUniqueOrThrow({ where: { id: incumbent.id } })).status,
    ).toBe('paused');

    await apply(
      {
        kind: 'subscription.expired',
        provider: 'apple_revenuecat',
        providerSubRef: incumbent.providerSubRef,
        cancelledAt: new Date('2026-08-20'),
      },
      gid,
    );
    expect(
      (await prisma.premiumMembership.findUniqueOrThrow({ where: { id: incumbent.id } })).status,
    ).toBe('expired');

    expect(conflictAlerts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route level — the failure the service tests describe is a 5xx retry loop
//
// The service tests above prove the P2002 is gone. This one proves what the
// P2002 actually cost: the RevenueCat route wraps applyMembershipEvent in a
// try/catch that captures and RETHROWS, so the escaping P2002 became a 500,
// `processedAt` stayed null, and RC redelivered the same event on its backoff
// into the same violation, forever. Apple is the right provider to pin this on
// — normalize-revenuecat's `original_transaction_id` keying is what puts a
// RENEWAL on an old, non-live row in the first place.
// ---------------------------------------------------------------------------

describe('POST /webhooks/revenuecat: RENEWAL onto a non-live row beside a live one', () => {
  const RC_AUTH = 'Bearer test-rc-secret-renew-conflict';
  let app: FastifyInstance;
  let originalAuth: string | undefined;
  let originalFlag: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    Sentry.captureMessage.mockClear();
    originalAuth = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    originalFlag = process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = RC_AUTH;
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    app = await makeApp();
  });

  afterEach(async () => {
    await app?.close();
    if (originalAuth === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    else process.env.REVENUECAT_WEBHOOK_AUTH_HEADER = originalAuth;
    if (originalFlag === undefined) delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
    else process.env.GROWTH_PREMIUM_BILLING_ENABLED = originalFlag;
  });

  it('answers 200 and marks the event processed instead of 5xx-ing forever', async () => {
    const { user } = await createUser({ email: 'rc-renew-conflict@jdm.test', verified: true });
    const gid = (await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } })).id;

    // The Apple row PR #44's activation guard refused and left expired, and the
    // Stripe subscription that won the garage's index slot.
    const appleRow = await seedMembership(gid, {
      provider: 'apple_revenuecat',
      providerCustomerRef: gid,
      providerSubRef: 'orig_txn_route',
      status: 'expired',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 2990,
    });
    await seedMembership(gid, { providerSubRef: 'sub_route_incumbent' });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/revenuecat',
      headers: { 'content-type': 'application/json', authorization: RC_AUTH },
      payload: JSON.stringify({
        event: {
          type: 'RENEWAL',
          id: 'rc_evt_renew_conflict',
          app_user_id: gid,
          product_id: 'premium_gold_monthly',
          country_code: 'BR',
          event_timestamp_ms: Date.now(),
          transaction_id: 'txn_renew_conflict',
          original_transaction_id: 'orig_txn_route',
          expiration_at_ms: new Date('2027-01-01').getTime(),
          period_type: 'NORMAL',
          price_in_purchased_currency: 29.9,
          currency: 'BRL',
          purchased_at_ms: Date.now(),
        },
      }),
    });

    expect(res.statusCode).toBe(200);

    const row = await prisma.subscriptionWebhookEvent.findFirstOrThrow({
      where: { providerEventId: 'rc_evt_renew_conflict' },
    });
    expect(row.processedAt).not.toBeNull();

    // Still outside the index, and the incumbent still inside it.
    const apple = await prisma.premiumMembership.findUniqueOrThrow({ where: { id: appleRow.id } });
    expect(apple.status).toBe('expired');
    expect(
      await prisma.premiumMembership.count({ where: { garageId: gid, status: 'active' } }),
    ).toBe(1);

    // The payment is in the books under the Apple row that was billed.
    const invoices = await prisma.premiumMembershipInvoice.findMany({
      where: { membershipId: appleRow.id },
    });
    expect(invoices).toHaveLength(1);

    const [call] = conflictAlerts();
    expect(call).toBeDefined();
    expect((call![1] as { level: string }).level).toBe('error');
    expect((call![1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      eventKind: 'subscription.renewed',
      memberWasCharged: true,
      statusFlipRefused: true,
    });
  });
});
