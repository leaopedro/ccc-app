import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = (status: 'draft' | 'published' | 'cancelled' = 'published') =>
  prisma.event.create({
    data: {
      slug: `ev-unpublish-${Math.random().toString(36).slice(2, 8)}`,
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

describe('POST /admin/events/:id/unpublish', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('flips published → draft, clears publishedAt, writes audit', async () => {
    const event = await mkEvent('published');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/unpublish`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('draft');
    expect(row.publishedAt).toBeNull();
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits.map((a) => a.action)).toContain('event.unpublish');
  });

  it('unpublished event is removed from public GET /events', async () => {
    const event = await mkEvent('published');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/unpublish`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    const publicRes = await app.inject({ method: 'GET', url: '/events' });
    const body: { items: { slug: string }[] } = publicRes.json();
    expect(body.items.map((i) => i.slug)).not.toContain(event.slug);
  });

  it('404 unknown id', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/events/missing/unpublish',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409 on duplicate unpublish call', async () => {
    const event = await mkEvent('published');
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const auth = { authorization: bearer(loadEnv(), user.id, 'organizer') };

    const first = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/unpublish`,
      headers: auth,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/admin/events/${event.id}/unpublish`,
      headers: auth,
    });
    expect(second.statusCode).toBe(409);
  });
});
