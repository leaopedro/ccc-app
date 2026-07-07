import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../../helpers.js';

const mkEvent = () =>
  prisma.event.create({
    data: {
      slug: 'old',
      title: 'Old',
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

describe('PATCH /admin/events/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('403 for user role', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'u@jdm.test', verified: true, role: 'user' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('applies a partial update and writes audit row', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.title).toBe('New');
    const audits = await prisma.adminAudit.findMany({ where: { actorId: user.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'event.update',
      entityType: 'event',
      entityId: event.id,
    });
  });

  it('rejects passing status via PATCH (use publish/cancel actions)', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { status: 'published' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 unknown id', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/events/missing',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('preserves coverObjectKey when patching an unrelated field', async () => {
    const event = await prisma.event.create({
      data: {
        slug: 'ev-cover-preserved',
        title: 'Old',
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
        coverObjectKey: 'event_cover/u/abc.jpg',
      },
    });
    const { user } = await createUser({ email: 'o2@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { title: 'New' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.coverObjectKey).toBe('event_cover/u/abc.jpg');
  });

  it('updates maxTicketsPerUser and returns new value', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o3@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { maxTicketsPerUser: 4 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ maxTicketsPerUser: number }>();
    expect(body.maxTicketsPerUser).toBe(4);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.maxTicketsPerUser).toBe(4);
  });

  it('accepts maxTicketsPerUser above legacy cap of 10 in PATCH', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o4@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { maxTicketsPerUser: 250 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ maxTicketsPerUser: number }>();
    expect(body.maxTicketsPerUser).toBe(250);
  });

  it('clears maxTicketsPerUser when patched with null (unlimited)', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o5@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { maxTicketsPerUser: null },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ maxTicketsPerUser: number | null }>();
    expect(body.maxTicketsPerUser).toBeNull();
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.maxTicketsPerUser).toBeNull();
  });

  it('400 on maxTicketsPerUser < 1 in PATCH', async () => {
    const event = await mkEvent();
    const { user } = await createUser({ email: 'o6@jdm.test', verified: true, role: 'organizer' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/events/${event.id}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
      payload: { maxTicketsPerUser: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});
