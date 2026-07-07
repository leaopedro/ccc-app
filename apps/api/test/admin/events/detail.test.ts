import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

describe('GET /admin/events/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('404 for unknown id', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events/does-not-exist',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns a draft event (which is invisible on public)', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const event = await prisma.event.create({
      data: {
        slug: 'draft-x',
        title: 'Draft',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'draft',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body: { status: string; publishedAt: unknown; tiers: unknown[] } = res.json();
    expect(body.status).toBe('draft');
    expect(body.publishedAt).toBeNull();
    expect(body.tiers).toEqual([]);
  });

  it('exposes quantitySold in admin tier', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const event = await prisma.event.create({
      data: {
        slug: 'with-tiers',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        venueName: 'v',
        venueAddress: 'a',
        city: 'São Paulo',
        stateCode: 'SP',
        type: 'meeting',
        capacity: 10,
        status: 'published',
        publishedAt: new Date(),
        tiers: {
          create: [
            { name: 'Geral', priceCents: 5000, quantityTotal: 100, quantitySold: 12, sortOrder: 0 },
          ],
        },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    const body: { tiers: { quantitySold: number; remainingCapacity: number }[] } = res.json();
    expect(body.tiers[0]?.quantitySold).toBe(12);
    expect(body.tiers[0]?.remainingCapacity).toBe(88);
  });
});
