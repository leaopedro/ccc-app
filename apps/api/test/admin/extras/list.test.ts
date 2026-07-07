import { prisma } from '@jdm/db';
import { adminExtraSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEventWithExtras = async () => {
  const event = await prisma.event.create({
    data: {
      slug: 'ev-extras-list',
      title: 't',
      description: 'd',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 90000_000),
      type: 'meeting',
      capacity: 10,
      status: 'draft',
    },
  });
  await prisma.ticketExtra.createMany({
    data: [
      { eventId: event.id, name: 'B-item', priceCents: 200, sortOrder: 1 },
      { eventId: event.id, name: 'A-item', priceCents: 100, sortOrder: 0 },
    ],
  });
  return event;
};

describe('GET /admin/events/:eventId/extras', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists extras ordered by sortOrder', async () => {
    const event = await mkEventWithExtras();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = z.object({ items: z.array(adminExtraSchema) }).parse(res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]!.name).toBe('A-item');
    expect(body.items[1]!.name).toBe('B-item');
  });

  it('returns empty list for event with no extras', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'ev-no-extras',
        title: 't',
        description: 'd',
        startsAt: new Date(Date.now() + 86400_000),
        endsAt: new Date(Date.now() + 90000_000),
        type: 'meeting',
        capacity: 10,
        status: 'draft',
      },
    });
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = z.object({ items: z.array(adminExtraSchema) }).parse(res.json());
    expect(body.items).toHaveLength(0);
  });

  it('404 for unknown event', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events/missing/extras',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401 without auth', async () => {
    const event = await mkEventWithExtras();
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/extras`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const event = await mkEventWithExtras();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/events/${event.id}/extras`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });
});
