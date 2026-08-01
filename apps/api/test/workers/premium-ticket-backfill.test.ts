import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import {
  processBackfillJob,
  runPremiumTicketBackfillTick,
} from '../../src/workers/premium-ticket-backfill.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

// ── seed helpers ────────────────────────────────────────────────────────────

type SeedEventOpts = {
  startsAtOffset?: number; // ms offset from now; default +1 day
  status?: 'published' | 'draft';
  isPremiumGrantable?: boolean;
  salesCloseAtOffset?: number | null; // null = no salesCloseAt; number = ms from now
};

const seedEvent = async (opts: SeedEventOpts = {}) => {
  const {
    startsAtOffset = 24 * 3600_000,
    status = 'published',
    isPremiumGrantable = true,
    salesCloseAtOffset = null,
  } = opts;

  const event = await prisma.event.create({
    data: {
      slug: `backfill-evt-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Backfill Test Event',
      description: 'd',
      startsAt: new Date(Date.now() + startsAtOffset),
      endsAt: new Date(Date.now() + startsAtOffset + 3600_000),
      type: 'meeting',
      status,
      ...(status === 'published' ? { publishedAt: new Date() } : {}),
      capacity: 1000,
    },
  });

  const tier = await prisma.ticketTier.create({
    data: {
      eventId: event.id,
      name: 'Premium GA',
      priceCents: 0,
      currency: 'BRL',
      quantityTotal: 1000,
      isPremiumGrantable,
      ...(salesCloseAtOffset !== null
        ? { salesCloseAt: new Date(Date.now() + salesCloseAtOffset) }
        : {}),
    },
  });

  return { event, tier };
};

const seedGarage = async (email: string) => {
  const { user } = await createUser({ email, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, garage };
};

const seedBackfillJob = (garageId: string) =>
  prisma.premiumTicketBackfillJob.create({ data: { garageId, status: 'pending' } });

// ── tests ────────────────────────────────────────────────────────────────────

describe('processBackfillJob', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('inserts one Ticket per published future event with a grantable tier', async () => {
    const { user, garage } = await seedGarage('backfill-happy@jdm.test');
    const { event: e1 } = await seedEvent();
    const { event: e2 } = await seedEvent({ startsAtOffset: 48 * 3600_000 });
    const job = await seedBackfillJob(garage.id);

    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
      orderBy: { createdAt: 'asc' },
    });
    expect(tickets).toHaveLength(2);
    const eventIds = tickets.map((t) => t.eventId);
    expect(eventIds).toContain(e1.id);
    expect(eventIds).toContain(e2.id);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('skips events where the user already has a valid premium_grant ticket (idempotent on replay)', async () => {
    const { user, garage } = await seedGarage('backfill-idem@jdm.test');
    const { event, tier } = await seedEvent();

    // Pre-existing valid premium_grant ticket (simulates partial completion).
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'premium_grant',
        status: 'valid',
      },
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    // Still exactly one ticket — not doubled.
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, eventId: event.id, status: 'valid' },
    });
    expect(tickets).toHaveLength(1);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('still grants when user already holds a purchase ticket (purchase + grant coexist)', async () => {
    const { user, garage } = await seedGarage('backfill-purchase@jdm.test');
    const { event, tier } = await seedEvent();

    // Pre-existing purchase ticket — must NOT block the premium grant.
    await prisma.ticket.create({
      data: {
        userId: user.id,
        eventId: event.id,
        tierId: tier.id,
        source: 'purchase',
        status: 'valid',
      },
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, eventId: event.id, status: 'valid' },
      orderBy: { source: 'asc' },
    });
    // Both rows coexist: 1 purchase + 1 premium_grant. The partial unique
    // (canon §F8.8) allows them; this test locks in that the worker does
    // not treat a purchase as a reason to skip the grant.
    expect(tickets).toHaveLength(2);
    expect(tickets.map((t) => t.source).sort()).toEqual(['premium_grant', 'purchase']);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('re-run after partial completion completes the remainder without double-grants', async () => {
    const { user, garage } = await seedGarage('backfill-partial@jdm.test');

    // 3 events — simulate job that completed for e1+e2 but e3 was not yet granted.
    const { event: e1, tier: t1 } = await seedEvent();
    const { event: e2, tier: t2 } = await seedEvent({ startsAtOffset: 36 * 3600_000 });
    const { event: e3 } = await seedEvent({ startsAtOffset: 72 * 3600_000 });

    await prisma.ticket.createMany({
      data: [
        {
          userId: user.id,
          eventId: e1.id,
          tierId: t1.id,
          source: 'premium_grant',
          status: 'valid',
        },
        {
          userId: user.id,
          eventId: e2.id,
          tierId: t2.id,
          source: 'premium_grant',
          status: 'valid',
        },
      ],
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    // Exactly 3 — e1+e2 untouched, e3 newly inserted.
    expect(tickets).toHaveLength(3);
    expect(tickets.map((t) => t.eventId)).toContain(e3.id);
  });

  it('skips events with no grantable tier and continues (structured log; does not abort)', async () => {
    const { user, garage } = await seedGarage('backfill-notier@jdm.test');

    // Event 1: has grantable tier → should get a ticket.
    const { event: good } = await seedEvent({ isPremiumGrantable: true });

    // Event 2: tier exists but isPremiumGrantable=false → no ticket; job continues.
    const { event: noTier } = await seedEvent({
      isPremiumGrantable: false,
      startsAtOffset: 48 * 3600_000,
    });

    const warnCalls: unknown[][] = [];
    const fakeLog = {
      warn: (...args: unknown[]) => {
        warnCalls.push(args);
      },
      info: () => {},
      error: () => {},
    } as never;

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env, log: fakeLog });

    // Only the good event got a ticket.
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.eventId).toBe(good.id);

    // Structured log emitted for the no-tier event.
    const hasNoTierLog = warnCalls.some((call) =>
      call.some(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as Record<string, unknown>)['eventId'] === noTier.id,
      ),
    );
    expect(hasNoTierLog).toBe(true);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('skips events whose salesCloseAt is in the past (closed sales)', async () => {
    const { user, garage } = await seedGarage('backfill-closed@jdm.test');

    // Tier with salesCloseAt 1 hour ago → not grantable by canon §F8.7.
    await seedEvent({ salesCloseAtOffset: -3600_000 });

    // Tier with no salesCloseAt → grantable.
    const { event: open } = await seedEvent({
      startsAtOffset: 48 * 3600_000,
      salesCloseAtOffset: null,
    });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.eventId).toBe(open.id);
  });

  it('does not grant tickets for past or draft events', async () => {
    const { user, garage } = await seedGarage('backfill-past@jdm.test');

    // Past event (started 1 hour ago).
    await seedEvent({ startsAtOffset: -3600_000, status: 'published' });

    // Draft event (not published).
    await seedEvent({ status: 'draft' });

    // One valid future published event.
    const { event: future } = await seedEvent({ startsAtOffset: 24 * 3600_000 });

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.eventId).toBe(future.id);
  });

  it('processes 50 events across a single inner-tx chunk and marks job completed', async () => {
    const { user, garage } = await seedGarage('backfill-50@jdm.test');

    // Seed 50 published future events each with a grantable tier.
    for (let i = 0; i < 50; i++) {
      await seedEvent({ startsAtOffset: (i + 1) * 3600_000 });
    }

    const job = await seedBackfillJob(garage.id);
    await processBackfillJob(job.id, { env });

    const count = await prisma.ticket.count({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(count).toBe(50);

    const doneJob = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(doneJob.status).toBe('completed');
  });

  it('does not re-process a job whose status is not pending', async () => {
    const { garage } = await seedGarage('backfill-already-completed@jdm.test');
    await seedEvent();

    const job = await prisma.premiumTicketBackfillJob.create({
      data: { garageId: garage.id, status: 'completed' },
    });

    await processBackfillJob(job.id, { env });

    // No tickets should have been created — the job was already completed
    // and processBackfillJob must short-circuit.
    const ticketCount = await prisma.ticket.count({
      where: { source: 'premium_grant', status: 'valid' },
    });
    expect(ticketCount).toBe(0);
  });
});

describe('runPremiumTicketBackfillTick', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('picks up pending jobs and completes them', async () => {
    const { user, garage } = await seedGarage('backfill-tick@jdm.test');
    await seedEvent();
    await seedBackfillJob(garage.id);

    await runPremiumTicketBackfillTick({ env });

    const tickets = await prisma.ticket.count({
      where: { userId: user.id, source: 'premium_grant', status: 'valid' },
    });
    expect(tickets).toBe(1);

    const jobs = await prisma.premiumTicketBackfillJob.findMany({
      where: { garageId: garage.id },
    });
    expect(jobs[0]!.status).toBe('completed');
  });

  it('does not process completed or failed jobs on re-tick', async () => {
    const { garage } = await seedGarage('backfill-skip@jdm.test');
    await seedEvent();

    const job = await prisma.premiumTicketBackfillJob.create({
      data: { garageId: garage.id, status: 'completed' },
    });

    await runPremiumTicketBackfillTick({ env });

    // Job already completed — must remain untouched.
    const after = await prisma.premiumTicketBackfillJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(after.status).toBe('completed');
  });
});
