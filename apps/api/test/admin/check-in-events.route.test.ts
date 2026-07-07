import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('GET /admin/check-in/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const seedEvent = (
    overrides: Partial<{
      slug: string;
      status: 'draft' | 'published' | 'cancelled';
      startsAt: Date;
      endsAt: Date;
    }>,
  ) =>
    prisma.event.create({
      data: {
        slug: overrides.slug ?? `e-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Test Event',
        description: 'd',
        startsAt: overrides.startsAt ?? new Date(Date.now() + 3600_000),
        endsAt: overrides.endsAt ?? new Date(Date.now() + 7200_000),
        venueName: 'V',
        venueAddress: 'A',
        city: 'SP',
        stateCode: 'SP',
        type: 'meeting',
        status: overrides.status ?? 'published',
        publishedAt: overrides.status === 'published' ? new Date() : null,
        capacity: 10,
      },
    });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/check-in/events',
      headers: { authorization: bearer(env, user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200 for staff and returns only published events in the 24h-back window', async () => {
    const upcoming = await seedEvent({ slug: 'upcoming' });
    const justEnded = await seedEvent({
      slug: 'just-ended',
      startsAt: new Date(Date.now() - 3 * 3600_000),
      endsAt: new Date(Date.now() - 3600_000),
    });
    await seedEvent({
      slug: 'long-past',
      startsAt: new Date(Date.now() - 72 * 3600_000),
      endsAt: new Date(Date.now() - 48 * 3600_000),
    });
    await seedEvent({ slug: 'draft-ev', status: 'draft' });
    await seedEvent({ slug: 'cancelled-ev', status: 'cancelled' });

    const { user } = await createUser({ email: 's@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/check-in/events',
      headers: { authorization: bearer(env, user.id, 'staff') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; slug: string }> }>();
    const slugs = body.items.map((i) => i.slug).sort();
    expect(slugs).toEqual(['just-ended', 'upcoming']);
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(upcoming.id);
    expect(ids).toContain(justEnded.id);
  });

  it('200 when event has null city and stateCode', async () => {
    await prisma.event.create({
      data: {
        slug: 'no-location',
        title: 'No Location Event',
        description: 'd',
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 7200_000),
        venueName: null,
        venueAddress: null,
        city: null,
        stateCode: null,
        type: 'meeting',
        status: 'published',
        publishedAt: new Date(),
        capacity: 10,
      },
    });

    const { user } = await createUser({ email: 'staff2@jdm.test', verified: true, role: 'staff' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/check-in/events',
      headers: { authorization: bearer(env, user.id, 'staff') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ city: string | null; stateCode: string | null }> }>();
    const nullEvent = body.items.find((i) => i.city === null);
    expect(nullEvent).toBeDefined();
    expect(nullEvent!.stateCode).toBeNull();
  });
});
