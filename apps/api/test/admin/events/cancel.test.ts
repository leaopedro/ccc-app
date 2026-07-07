import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = (status: 'draft' | 'published' = 'published') =>
  prisma.event.create({
    data: {
      slug: 'ev-cancel-test',
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
      status,
      publishedAt: status === 'published' ? new Date() : null,
    },
  });

describe('POST /admin/events/:id/cancel', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('flips published → cancelled and hides from public list', async () => {
    const event = await mkEvent('published');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/cancel`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('cancelled');
    const publicRes = await app.inject({ method: 'GET', url: '/events' });
    const body: { items: { slug: string }[] } = publicRes.json();
    expect(body.items.map((i) => i.slug)).not.toContain(event.slug);
  });

  it('409 when already cancelled', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'already-cancelled',
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
        status: 'cancelled',
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/cancel`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(409);
  });
});
