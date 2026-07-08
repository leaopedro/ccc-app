// apps/api/test/admin/events/publish-grant.test.ts
//
// Integration tests for the publish handler + premium-grant worker hook
// (chunk F8.07). Locks in:
//   1. Publish tx commits even if the worker throws (fire-and-forget).
//   2. Happy path: worker runs after publish and grants the ticket.
//   3. Feature-flag gate: worker is NOT called when the flag is off.

import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import * as workerModule from '../../../src/workers/premium-event-publish-grant.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const seedDraftEvent = (slug = `evt-pg-${Math.random().toString(36).slice(2, 10)}`) =>
  prisma.event.create({
    data: {
      slug,
      title: 'Draft Event',
      description: 'd',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3_600_000),
      type: 'meeting',
      status: 'draft',
      capacity: 500,
      coverObjectKey: 'event_cover/test/test.jpg',
    },
  });

const seedActiveMember = async (email: string) => {
  const { user } = await createUser({ email, verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: `cus_${Math.random().toString(36).slice(2, 12)}`,
      providerSubRef: `sub_${Math.random().toString(36).slice(2, 12)}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      baseAmountCents: 2990,
      devFeePercent: 10,
      devFeeAmountCents: 299,
      grossAmountCents: 3289,
      currency: 'BRL',
    },
  });
  return { user, garage };
};

describe('POST /admin/events/:id/publish — premium-grant hook', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'true';
    app = await makeApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
  });

  it('publish tx commits and returns 200 even if grant job throws (fire-and-forget)', async () => {
    const event = await seedDraftEvent('evt-pg-isolation');

    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Premium',
        priceCents: 0,
        quantityTotal: 999,
        isPremiumGrantable: true,
      },
    });

    await seedActiveMember('member-isolation@jdm.test');

    // Force the worker to reject. The route uses .catch() so this MUST NOT
    // surface to the HTTP response.
    const spy = vi
      .spyOn(workerModule, 'runPremiumEventPublishGrant')
      .mockRejectedValue(new Error('simulated worker failure'));

    const { user: admin } = await createUser({
      email: 'admin-iso@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/publish`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });

    // HTTP response is 200 — the publish tx already committed.
    expect(res.statusCode).toBe(200);
    const body: { status: string } = res.json();
    expect(body.status).toBe('published');

    // Event row persists.
    const dbEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(dbEvent.status).toBe('published');

    // No tickets inserted (worker threw before doing any work).
    const ticketCount = await prisma.ticket.count({ where: { eventId: event.id } });
    expect(ticketCount).toBe(0);

    // The worker WAS called by the route.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('happy path: publish triggers worker which grants ticket asynchronously', async () => {
    const event = await seedDraftEvent('evt-pg-happy');

    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Premium',
        priceCents: 0,
        quantityTotal: 999,
        isPremiumGrantable: true,
      },
    });

    const { user: member } = await seedActiveMember('member-happy@jdm.test');

    // Track when the worker resolves so we can deterministically await it.
    let workerDone: () => void = () => undefined;
    const workerPromise = new Promise<void>((resolve) => {
      workerDone = resolve;
    });
    const original = workerModule.runPremiumEventPublishGrant;
    vi.spyOn(workerModule, 'runPremiumEventPublishGrant').mockImplementation(async (input) => {
      await original(input);
      workerDone();
    });

    const { user: admin } = await createUser({
      email: 'admin-happy@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/publish`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });

    expect(res.statusCode).toBe(200);

    // Wait for the fire-and-forget worker to finish.
    await workerPromise;

    const ticket = await prisma.ticket.findFirst({
      where: {
        userId: member.id,
        eventId: event.id,
        status: 'valid',
        source: 'premium_grant',
      },
    });
    expect(ticket).not.toBeNull();
  });

  it('flag disabled: worker is NOT called when GROWTH_PREMIUM_BILLING_ENABLED=false', async () => {
    // Close the flag-on app from beforeEach and rebuild with flag off.
    await app.close();
    process.env.GROWTH_PREMIUM_BILLING_ENABLED = 'false';
    app = await makeApp();

    const event = await seedDraftEvent('evt-pg-flag-off');
    await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Premium',
        priceCents: 0,
        quantityTotal: 999,
        isPremiumGrantable: true,
      },
    });
    await seedActiveMember('member-flag-off@jdm.test');

    const spy = vi.spyOn(workerModule, 'runPremiumEventPublishGrant');

    const { user: admin } = await createUser({
      email: 'admin-flag-off@jdm.test',
      verified: true,
      role: 'organizer',
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/publish`,
      headers: { authorization: bearer(env, admin.id, 'organizer') },
    });

    expect(res.statusCode).toBe(200);
    expect(spy).not.toHaveBeenCalled();

    const ticketCount = await prisma.ticket.count({ where: { eventId: event.id } });
    expect(ticketCount).toBe(0);
  });
});
