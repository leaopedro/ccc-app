import { prisma } from '@jdm/db';
import {
  PremiumCadence,
  PremiumMembershipStatus,
  PremiumProvider,
  TicketSource,
} from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, resetDatabase } from '../helpers.js';

// Helpers
const garageFor = (userId: string) => prisma.garage.findUniqueOrThrow({ where: { userId } });

// Minimal valid PremiumMembership seed (no row insert helper in helpers.ts yet
// for F8 models — construct inline).
const makeMembership = (
  garageId: string,
  overrides: Partial<{
    status: PremiumMembershipStatus;
    provider: PremiumProvider;
    providerSubRef: string;
    providerCustomerRef: string;
  }> = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: overrides.provider ?? PremiumProvider.stripe,
      providerCustomerRef: overrides.providerCustomerRef ?? 'cus_test001',
      providerSubRef: overrides.providerSubRef ?? `sub_${Date.now()}`,
      tier: 'gold',
      cadence: PremiumCadence.monthly,
      status: overrides.status ?? PremiumMembershipStatus.active,
      currentPeriodStart: new Date('2026-05-01'),
      currentPeriodEnd: new Date('2026-06-01'),
      baseAmountCents: 2000,
      devFeePercent: 10,
      devFeeAmountCents: 200,
      grossAmountCents: 2200,
      currency: 'BRL',
    },
  });

describe('schema: F8 premium billing tables + partial unique indexes (chunk F8.01)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  // ── PremiumMembership ──────────────────────────────────────────────────────

  it('creates PremiumMembership with all required fields', async () => {
    const { user } = await createUser({ email: 'pm1@jdm.test' });
    const garage = await garageFor(user.id);
    const membership = await makeMembership(garage.id);
    expect(membership.id).toBeTruthy();
    expect(membership.devFeePercent).toBe(10);
    expect(membership.status).toBe('active');
  });

  it('partial unique index: rejects second active row for same garage (premium_membership_live_per_garage)', async () => {
    const { user } = await createUser({ email: 'pm2@jdm.test' });
    const garage = await garageFor(user.id);

    await makeMembership(garage.id, { providerSubRef: 'sub_first' });

    // Second active row for the same garage must be rejected by the partial index.
    await expect(makeMembership(garage.id, { providerSubRef: 'sub_second' })).rejects.toMatchObject(
      { code: 'P2002' },
    );
  });

  it('partial unique index: allows a second row when first row is expired (history accumulates)', async () => {
    const { user } = await createUser({ email: 'pm3@jdm.test' });
    const garage = await garageFor(user.id);

    // First membership is expired — not covered by the partial index.
    await makeMembership(garage.id, {
      providerSubRef: 'sub_expired',
      status: PremiumMembershipStatus.expired,
    });

    // Re-subscribe: fresh active row must succeed.
    const resub = await makeMembership(garage.id, {
      providerSubRef: 'sub_active_resub',
      status: PremiumMembershipStatus.active,
    });
    expect(resub.status).toBe('active');
  });

  it('partial unique covers all three live statuses (active, past_due, cancel_scheduled)', async () => {
    const statuses: PremiumMembershipStatus[] = [
      PremiumMembershipStatus.active,
      PremiumMembershipStatus.past_due,
      PremiumMembershipStatus.cancel_scheduled,
    ];

    for (const liveStatus of statuses) {
      // Fresh user+garage for each status to avoid cross-contamination.
      const { user } = await createUser({ email: `pm-live-${liveStatus}@jdm.test` });
      const garage = await garageFor(user.id);

      // First row with this live status is fine.
      await makeMembership(garage.id, {
        providerSubRef: `sub_first_${liveStatus}`,
        status: liveStatus,
      });

      // Second row with ANY live status must be blocked.
      await expect(
        makeMembership(garage.id, {
          providerSubRef: `sub_second_${liveStatus}`,
          status: PremiumMembershipStatus.active,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    }
  });

  it('confirms partial unique index exists in pg_indexes', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'PremiumMembership'
        AND indexname = 'premium_membership_live_per_garage'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE/i);
  });

  // ── Ticket partial unique (narrowed to source='premium_grant') ─────────────
  //
  // The broader (status='valid') variant was dropped in migration
  // 20260503163319_drop_ticket_user_event_unique because multi-ticket purchases
  // (Event.maxTicketsPerUser > 1) and comp grants legitimately create multiple
  // valid tickets per (userId, eventId). The narrowed index in this migration
  // (status='valid' AND source='premium_grant') is the DB-level idempotency
  // backstop for F8.06 backfill + F8.07 publish-hook only.

  const seedEventWithTier = async (slug: string) => {
    const event = await prisma.event.create({
      data: {
        slug,
        title: `Event ${slug}`,
        description: 'ticket partial index test',
        startsAt: new Date('2026-08-01'),
        endsAt: new Date('2026-08-01'),
        type: 'meeting',
        capacity: 100,
        tiers: {
          create: { name: 'Standard', priceCents: 0, quantityTotal: 100 },
        },
      },
      include: { tiers: true },
    });
    return { eventId: event.id, tierId: event.tiers[0]!.id };
  };

  const makeTicket = (userId: string, eventId: string, tierId: string, source: TicketSource) =>
    prisma.ticket.create({
      data: { userId, eventId, tierId, source, status: 'valid' },
    });

  it('confirms ticket_one_premium_grant_per_user_event partial unique index exists in pg_indexes', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'Ticket'
        AND indexname = 'ticket_one_premium_grant_per_user_event'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE/i);
    expect(rows[0]!.indexdef).toMatch(/premium_grant/);
  });

  it('partial unique blocks a second valid premium_grant ticket for same (userId, eventId)', async () => {
    const { user } = await createUser({ email: 'pg1@jdm.test' });
    const { eventId, tierId } = await seedEventWithTier('event-pg-1');

    await makeTicket(user.id, eventId, tierId, TicketSource.premium_grant);
    await expect(
      makeTicket(user.id, eventId, tierId, TicketSource.premium_grant),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('partial unique does NOT block multiple valid purchase tickets (multi-ticket orders)', async () => {
    const { user } = await createUser({ email: 'pg2@jdm.test' });
    const { eventId, tierId } = await seedEventWithTier('event-pg-2');

    const t1 = await makeTicket(user.id, eventId, tierId, TicketSource.purchase);
    const t2 = await makeTicket(user.id, eventId, tierId, TicketSource.purchase);
    const t3 = await makeTicket(user.id, eventId, tierId, TicketSource.purchase);
    expect([t1.id, t2.id, t3.id].every(Boolean)).toBe(true);
  });

  it('partial unique does NOT block multiple valid comp tickets', async () => {
    const { user } = await createUser({ email: 'pg3@jdm.test' });
    const { eventId, tierId } = await seedEventWithTier('event-pg-3');

    const t1 = await makeTicket(user.id, eventId, tierId, TicketSource.comp);
    const t2 = await makeTicket(user.id, eventId, tierId, TicketSource.comp);
    expect([t1.id, t2.id].every(Boolean)).toBe(true);
  });

  it('partial unique allows premium_grant alongside purchase + comp for same (userId, eventId)', async () => {
    const { user } = await createUser({ email: 'pg4@jdm.test' });
    const { eventId, tierId } = await seedEventWithTier('event-pg-4');

    const grant = await makeTicket(user.id, eventId, tierId, TicketSource.premium_grant);
    const purchase = await makeTicket(user.id, eventId, tierId, TicketSource.purchase);
    const comp = await makeTicket(user.id, eventId, tierId, TicketSource.comp);
    expect([grant.id, purchase.id, comp.id].every(Boolean)).toBe(true);
  });

  it('partial unique allows a second premium_grant once the first is revoked (status != valid)', async () => {
    const { user } = await createUser({ email: 'pg5@jdm.test' });
    const { eventId, tierId } = await seedEventWithTier('event-pg-5');

    const first = await makeTicket(user.id, eventId, tierId, TicketSource.premium_grant);
    await prisma.ticket.update({ where: { id: first.id }, data: { status: 'revoked' } });

    const second = await makeTicket(user.id, eventId, tierId, TicketSource.premium_grant);
    expect(second.id).toBeTruthy();
  });

  // ── TicketTier.isPremiumGrantable ──────────────────────────────────────────

  it('TicketTier.isPremiumGrantable defaults to false', async () => {
    // Use raw SQL to bypass Prisma's default substitution and confirm the column
    // default is physically false at the DB level.
    // Find an existing TicketTier row (or create one via prisma if none).
    // The testcontainer starts empty so we need a full event + tier scaffold.
    // We only care about the column default, not the full event lifecycle.
    const event = await prisma.event.create({
      data: {
        slug: 'test-event-f8-01',
        title: 'Test Event F8',
        description: 'schema test',
        startsAt: new Date('2026-07-01'),
        endsAt: new Date('2026-07-01'),
        type: 'meeting',
        capacity: 100,
        tiers: {
          create: {
            name: 'Standard',
            priceCents: 0,
            quantityTotal: 100,
          },
        },
      },
      include: { tiers: true },
    });

    const tier = event.tiers[0]!;

    const rows = await prisma.$queryRaw<Array<{ isPremiumGrantable: boolean }>>`
      SELECT "isPremiumGrantable" FROM "TicketTier" WHERE id = ${tier.id}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isPremiumGrantable).toBe(false);
  });

  it('TicketTier.isPremiumGrantable can be set to true', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'test-event-f8-02',
        title: 'Test Event F8 Grantable',
        description: 'schema test grantable',
        startsAt: new Date('2026-07-01'),
        endsAt: new Date('2026-07-01'),
        type: 'meeting',
        capacity: 100,
        tiers: {
          create: {
            name: 'Premium',
            priceCents: 0,
            quantityTotal: 100,
            isPremiumGrantable: true,
          },
        },
      },
      include: { tiers: true },
    });

    const tier = event.tiers[0]!;
    expect(tier.isPremiumGrantable).toBe(true);
  });

  // ── SubscriptionWebhookEvent ───────────────────────────────────────────────

  it('creates SubscriptionWebhookEvent with payload Json', async () => {
    const swe = await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: PremiumProvider.stripe,
        providerEventId: 'evt_test_001',
        type: 'invoice.paid',
        payload: { raw: 'stripe_payload' },
      },
    });
    expect(swe.processedAt).toBeNull();
    expect(swe.payload).toEqual({ raw: 'stripe_payload' });
  });

  it('rejects duplicate (provider, providerEventId) on SubscriptionWebhookEvent (replay dedup)', async () => {
    await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: PremiumProvider.stripe,
        providerEventId: 'evt_replay_001',
        type: 'invoice.paid',
        payload: {},
      },
    });

    await expect(
      prisma.subscriptionWebhookEvent.create({
        data: {
          provider: PremiumProvider.stripe,
          providerEventId: 'evt_replay_001',
          type: 'invoice.paid',
          payload: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ── PremiumMembershipInvoice ───────────────────────────────────────────────

  it('creates PremiumMembershipInvoice linked to PremiumMembership', async () => {
    const { user } = await createUser({ email: 'pmi1@jdm.test' });
    const garage = await garageFor(user.id);
    const membership = await makeMembership(garage.id, { providerSubRef: 'sub_inv_test' });

    const invoice = await prisma.premiumMembershipInvoice.create({
      data: {
        membershipId: membership.id,
        provider: PremiumProvider.stripe,
        providerInvoiceRef: 'in_test_001',
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-06-01'),
        baseAmountCents: 2000,
        devFeePercent: 10,
        devFeeAmountCents: 200,
        grossAmountCents: 2200,
        currency: 'BRL',
        paidAt: new Date(),
        status: 'paid',
      },
    });

    expect(invoice.membershipId).toBe(membership.id);
    expect(invoice.status).toBe('paid');
  });

  it('rejects duplicate (provider, providerInvoiceRef) on PremiumMembershipInvoice (webhook dedup)', async () => {
    const { user } = await createUser({ email: 'pmi2@jdm.test' });
    const garage = await garageFor(user.id);
    const membership = await makeMembership(garage.id, { providerSubRef: 'sub_inv_dup' });

    const invoiceData = {
      membershipId: membership.id,
      provider: PremiumProvider.stripe,
      providerInvoiceRef: 'in_dup_001',
      periodStart: new Date('2026-05-01'),
      periodEnd: new Date('2026-06-01'),
      baseAmountCents: 2000,
      devFeePercent: 10,
      devFeeAmountCents: 200,
      grossAmountCents: 2200,
      currency: 'BRL',
      paidAt: new Date(),
      status: 'paid',
    };

    await prisma.premiumMembershipInvoice.create({ data: invoiceData });

    await expect(
      prisma.premiumMembershipInvoice.create({ data: invoiceData }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
