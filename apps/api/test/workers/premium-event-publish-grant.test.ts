// apps/api/test/workers/premium-event-publish-grant.test.ts
//
// Tests for the event-publish premium-grant worker (chunk F8.07).
//
// Worker is called post-commit from the admin publish handler. It pages
// through active PremiumMembership rows and inserts a premium_grant Ticket
// per eligible member. Idempotent via the partial-unique index on Ticket
// (canon §F8.8).

import { prisma } from '@jdm/db';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runPremiumEventPublishGrant } from '../../src/workers/premium-event-publish-grant.js';
import { createUser, resetDatabase } from '../helpers.js';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

const seedEvent = async (
  overrides: {
    startsAt?: Date;
    status?: 'draft' | 'published';
  } = {},
) => {
  const startsAt = overrides.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return prisma.event.create({
    data: {
      slug: `evt-publish-grant-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Grant Test Event',
      description: 'd',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      type: 'meeting',
      status: overrides.status ?? 'published',
      capacity: 2000,
      publishedAt: overrides.status === 'draft' ? null : new Date(),
    },
  });
};

const seedGrantableTier = async (eventId: string) =>
  prisma.ticketTier.create({
    data: {
      eventId,
      name: 'Premium Acesso',
      priceCents: 0,
      quantityTotal: 99999,
      isPremiumGrantable: true,
    },
  });

const seedNonGrantableTier = async (eventId: string) =>
  prisma.ticketTier.create({
    data: {
      eventId,
      name: 'VIP Pago',
      priceCents: 5000,
      quantityTotal: 100,
      isPremiumGrantable: false,
    },
  });

const seedActiveMembership = async (
  garageId: string,
  overrides: {
    status?: 'active' | 'past_due' | 'cancel_scheduled' | 'expired' | 'paused' | 'trialing';
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date;
  } = {},
) =>
  prisma.premiumMembership.create({
    data: {
      garageId,
      provider: 'stripe',
      providerCustomerRef: `cus_${Math.random().toString(36).slice(2, 12)}`,
      providerSubRef: `sub_${Math.random().toString(36).slice(2, 12)}`,
      tier: 'gold',
      cadence: 'monthly',
      status: overrides.status ?? 'active',
      currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      currentPeriodEnd:
        overrides.currentPeriodEnd ?? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
    },
  });

type LogEntry = { msg: string; eventId?: string; reason?: string };

const makeLog = () => {
  const logs: LogEntry[] = [];
  const push = (obj: unknown, msg: string): void => {
    logs.push({ msg, ...(obj as object) });
  };
  const log = {
    info: push,
    warn: push,
    error: push,
  };
  return { log, logs };
};

describe('runPremiumEventPublishGrant', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('skips and logs premium_grant.no_tier when no isPremiumGrantable tier exists', async () => {
    const event = await seedEvent();
    await seedNonGrantableTier(event.id);

    const { user } = await createUser({ email: 'u1@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id);

    const { log, logs } = makeLog();
    await runPremiumEventPublishGrant({
      eventId: event.id,
      publishedAt: new Date(),
      log: log as unknown as FastifyBaseLogger,
    });

    const tickets = await prisma.ticket.count({ where: { eventId: event.id } });
    expect(tickets).toBe(0);

    const noTierLog = logs.find((l) => l.msg === 'premium_grant.no_tier');
    expect(noTierLog).toBeDefined();
    expect(noTierLog?.eventId).toBe(event.id);
    expect(noTierLog?.reason).toBe('publish_hook');
  });

  it('grants one ticket to one active member with no existing ticket', async () => {
    const event = await seedEvent();
    const tier = await seedGrantableTier(event.id);

    const { user } = await createUser({ email: 'u2@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id);

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

    const ticket = await prisma.ticket.findFirst({
      where: { userId: user.id, eventId: event.id, status: 'valid', source: 'premium_grant' },
    });
    expect(ticket).not.toBeNull();
    expect(ticket?.tierId).toBe(tier.id);
  });

  it('is idempotent: replaying the job does not insert a second ticket', async () => {
    const event = await seedEvent();
    await seedGrantableTier(event.id);

    const { user } = await createUser({ email: 'u3@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id);

    const args = { eventId: event.id, publishedAt: new Date() };
    await runPremiumEventPublishGrant(args);
    await runPremiumEventPublishGrant(args);

    const count = await prisma.ticket.count({
      where: { userId: user.id, eventId: event.id, status: 'valid' },
    });
    expect(count).toBe(1);
  });

  it('skips member with cancelAtPeriodEnd=true AND currentPeriodEnd before event.startsAt', async () => {
    // Event starts 30 days from now; sub expires in 10 days (clearly before).
    const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const event = await seedEvent({ startsAt });
    await seedGrantableTier(event.id);

    const { user } = await createUser({ email: 'u4@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id, {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

    const count = await prisma.ticket.count({ where: { userId: user.id, eventId: event.id } });
    expect(count).toBe(0);
  });

  // Spec §4.6 filter is AND: status='active' AND cancelAtPeriodEnd=false AND
  // currentPeriodEnd > event.startsAt. A member with cancelAtPeriodEnd=true
  // is skipped regardless of whether currentPeriodEnd covers the event.
  // This test locks the spec-correct semantics.
  it('skips member with cancelAtPeriodEnd=true even when currentPeriodEnd covers event.startsAt', async () => {
    const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const event = await seedEvent({ startsAt });
    await seedGrantableTier(event.id);

    const { user } = await createUser({ email: 'u5@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id, {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

    const count = await prisma.ticket.count({ where: { userId: user.id, eventId: event.id } });
    expect(count).toBe(0);
  });

  it('does not grant a second premium_grant ticket when the user already holds one', async () => {
    const event = await seedEvent();
    const tier = await seedGrantableTier(event.id);

    const { user } = await createUser({ email: 'u6@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id);

    // Pre-existing premium_grant ticket — partial unique should keep it at 1.
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'premium_grant',
        status: 'valid',
      },
    });

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

    const count = await prisma.ticket.count({
      where: { userId: user.id, eventId: event.id, status: 'valid', source: 'premium_grant' },
    });
    expect(count).toBe(1);
  });

  it('skips inactive memberships (past_due, expired, paused, cancel_scheduled)', async () => {
    const event = await seedEvent();
    await seedGrantableTier(event.id);

    const setups: Array<{
      email: string;
      status: 'past_due' | 'expired' | 'paused' | 'cancel_scheduled';
    }> = [
      { email: 'past-due@jdm.test', status: 'past_due' },
      { email: 'expired@jdm.test', status: 'expired' },
      { email: 'paused@jdm.test', status: 'paused' },
      { email: 'cancel-scheduled@jdm.test', status: 'cancel_scheduled' },
    ];

    for (const setup of setups) {
      const { user } = await createUser({ email: setup.email, verified: true });
      const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
      await seedActiveMembership(garage.id, { status: setup.status });
    }

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

    const tickets = await prisma.ticket.count({ where: { eventId: event.id } });
    expect(tickets).toBe(0);
  });

  it('grants tickets to many active members across multiple batch pages', async () => {
    // The worker pages PremiumMembership 500/inner-tx. Use 600 to force two
    // pages without making the test slow.
    const event = await seedEvent();
    await seedGrantableTier(event.id);

    const TOTAL = 600;
    const BATCH = 50;

    const userIds: string[] = [];
    for (let b = 0; b < TOTAL / BATCH; b++) {
      const batch = await Promise.all(
        Array.from({ length: BATCH }, (_, i) =>
          createUser({ email: `bulk-${b}-${i}@jdm.test`, verified: true }),
        ),
      );
      userIds.push(...batch.map((r) => r.user.id));
    }

    const garages = await prisma.garage.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });

    for (let b = 0; b < garages.length / BATCH; b++) {
      await Promise.all(
        garages.slice(b * BATCH, (b + 1) * BATCH).map((g) => seedActiveMembership(g.id)),
      );
    }

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt: new Date() });

    const ticketCount = await prisma.ticket.count({
      where: { eventId: event.id, status: 'valid', source: 'premium_grant' },
    });
    expect(ticketCount).toBe(TOTAL);
  }, 90_000);

  // Reviewer fix: tier eligibility must be pinned to publishedAt, not the
  // current wall clock. If a job is enqueued at publish time and retried
  // minutes later, a tier whose salesCloseAt lapsed between publish and
  // retry MUST still be picked.
  it('pins tier eligibility to publishedAt (salesCloseAt lapsed after publish)', async () => {
    const publishedAt = new Date(Date.now() - 60 * 60 * 1000);
    // Tier sales closed 30 minutes after publish, but 30 minutes ago in
    // wall-clock terms — so `salesCloseAt` is in the past relative to now,
    // but in the future relative to publishedAt.
    const salesCloseAt = new Date(publishedAt.getTime() + 30 * 60 * 1000);

    const event = await seedEvent();
    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Premium Acesso',
        priceCents: 0,
        quantityTotal: 99999,
        isPremiumGrantable: true,
        salesCloseAt,
      },
    });

    const { user } = await createUser({ email: 'pin-publishedAt@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await seedActiveMembership(garage.id);

    await runPremiumEventPublishGrant({ eventId: event.id, publishedAt });

    const ticket = await prisma.ticket.findFirst({
      where: { userId: user.id, eventId: event.id, status: 'valid', source: 'premium_grant' },
    });
    expect(ticket).not.toBeNull();
  });
});
