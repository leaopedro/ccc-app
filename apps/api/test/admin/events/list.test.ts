import { prisma } from '@jdm/db';
import { adminEventListResponseSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = (slug: string, status: 'draft' | 'published' | 'cancelled') =>
  prisma.event.create({
    data: {
      slug,
      title: slug,
      description: 'd',
      startsAt: new Date(Date.now() + 7 * 86400_000),
      endsAt: new Date(Date.now() + 7 * 86400_000 + 3600_000),
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

describe('GET /admin/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/events' });
    expect(res.statusCode).toBe(401);
  });

  it('403 for user role', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns all statuses (incl. draft + cancelled), newest first', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    await mkEvent('a', 'draft');
    await mkEvent('b', 'published');
    await mkEvent('c', 'cancelled');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/events',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminEventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug).sort()).toEqual(['a', 'b', 'c']);
    // newest first: c, b, a (createdAt desc)
    expect(body.items[0]?.slug).toBe('c');
  });
});
