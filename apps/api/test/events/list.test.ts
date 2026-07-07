import { prisma } from '@jdm/db';
import { eventListResponseSchema } from '@jdm/shared/events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

const makeEvent = async (
  overrides: Partial<{
    slug: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    status: 'draft' | 'published' | 'cancelled';
    type: 'meeting' | 'drift' | 'other';
    stateCode: string;
    city: string;
  }> = {},
) => {
  return prisma.event.create({
    data: {
      slug: overrides.slug ?? `e-${Math.random().toString(36).slice(2, 8)}`,
      title: overrides.title ?? 'Encontro',
      description: 'desc',
      startsAt: overrides.startsAt ?? new Date(Date.now() + 7 * 86400_000),
      endsAt: overrides.endsAt ?? new Date(Date.now() + 7 * 86400_000 + 3600_000),
      venueName: 'Autódromo',
      venueAddress: 'Rua X, 100',
      city: overrides.city ?? 'São Paulo',
      stateCode: overrides.stateCode ?? 'SP',
      type: overrides.type ?? 'meeting',
      status: overrides.status ?? 'published',
      capacity: 100,
      publishedAt: overrides.status === 'draft' ? null : new Date(),
    },
  });
};

describe('GET /events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns published upcoming events sorted by startsAt ASC', async () => {
    const soon = await makeEvent({ slug: 'soon', startsAt: new Date(Date.now() + 2 * 86400_000) });
    const later = await makeEvent({
      slug: 'later',
      startsAt: new Date(Date.now() + 10 * 86400_000),
    });
    await makeEvent({
      slug: 'past',
      startsAt: new Date(Date.now() - 86400_000),
      endsAt: new Date(Date.now() - 43200_000),
    });
    await makeEvent({ slug: 'draft', status: 'draft' });

    const res = await app.inject({ method: 'GET', url: '/events' });
    expect(res.statusCode).toBe(200);
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual([soon.slug, later.slug]);
    expect(body.nextCursor).toBeNull();
  });

  it('window=past returns only past events, DESC by startsAt', async () => {
    const old = await makeEvent({
      slug: 'old',
      startsAt: new Date(Date.now() - 30 * 86400_000),
      endsAt: new Date(Date.now() - 29 * 86400_000),
    });
    const recent = await makeEvent({
      slug: 'recent',
      startsAt: new Date(Date.now() - 2 * 86400_000),
      endsAt: new Date(Date.now() - 86400_000),
    });
    await makeEvent({ slug: 'future' });

    const res = await app.inject({ method: 'GET', url: '/events?window=past' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual([recent.slug, old.slug]);
  });

  it('window=all returns both, ASC by startsAt', async () => {
    await makeEvent({
      slug: 'a',
      startsAt: new Date(Date.now() - 86400_000),
      endsAt: new Date(Date.now() - 3600_000),
    });
    await makeEvent({ slug: 'b', startsAt: new Date(Date.now() + 86400_000) });
    const res = await app.inject({ method: 'GET', url: '/events?window=all' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual(['a', 'b']);
  });

  it('filters by stateCode and type', async () => {
    await makeEvent({ slug: 'sp-meet', stateCode: 'SP', type: 'meeting' });
    await makeEvent({ slug: 'rj-meet', stateCode: 'RJ', type: 'meeting' });
    await makeEvent({ slug: 'sp-drift', stateCode: 'SP', type: 'drift' });

    const res = await app.inject({ method: 'GET', url: '/events?stateCode=SP&type=meeting' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toEqual(['sp-meet']);
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await makeEvent({ slug: `p-${i}`, startsAt: new Date(Date.now() + (i + 1) * 86400_000) });
    }
    const first = await app.inject({ method: 'GET', url: '/events?limit=2' });
    const firstBody = eventListResponseSchema.parse(first.json());
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/events?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    });
    const secondBody = eventListResponseSchema.parse(second.json());
    expect(secondBody.items).toHaveLength(2);
    expect(secondBody.items[0]!.slug).not.toBe(firstBody.items[0]!.slug);
  });

  it('rejects invalid stateCode with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/events?stateCode=XX' });
    expect(res.statusCode).toBe(400);
  });

  it('last page returns nextCursor null', async () => {
    for (let i = 0; i < 4; i++) {
      await makeEvent({ slug: `q-${i}`, startsAt: new Date(Date.now() + (i + 1) * 86400_000) });
    }
    const first = await app.inject({ method: 'GET', url: '/events?limit=2' });
    const firstBody = eventListResponseSchema.parse(first.json());
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/events?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    });
    const secondBody = eventListResponseSchema.parse(second.json());
    expect(secondBody.items).toHaveLength(2);
    expect(secondBody.nextCursor).toBeNull();
  });

  it('window=upcoming includes currently in-progress events', async () => {
    const inProgress = await makeEvent({
      slug: 'in-progress',
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await app.inject({ method: 'GET', url: '/events?window=upcoming' });
    const body = eventListResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.slug)).toContain(inProgress.slug);
  });
});
