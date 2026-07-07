import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkFeedBan } from '../../src/services/feed/ban-check.js';
import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('checkFeedBan', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const seedEvent = () =>
    prisma.event.create({
      data: {
        title: 'Feed Event',
        slug: 'feed-event',
        description: 'Feed event description',
        startsAt: new Date('2026-07-01T18:00:00Z'),
        endsAt: new Date('2026-07-01T22:00:00Z'),
        type: 'meeting',
        status: 'published',
        capacity: 100,
      },
    });

  it('returns null when user has no ban', async () => {
    const event = await seedEvent();
    const { user } = await createUser();
    const result = await checkFeedBan(event.id, user.id);
    expect(result).toBeNull();
  });

  it('returns "view" when user has a view ban', async () => {
    const event = await seedEvent();
    const { user } = await createUser();
    const { user: admin } = await createUser({ email: 'admin@jdm.test', role: 'admin' });
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: user.id, scope: 'view', bannedById: admin.id },
    });
    const result = await checkFeedBan(event.id, user.id);
    expect(result).toBe('view');
  });

  it('returns "post" when user has a post ban', async () => {
    const event = await seedEvent();
    const { user } = await createUser();
    const { user: admin } = await createUser({ email: 'admin@jdm.test', role: 'admin' });
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: user.id, scope: 'post', bannedById: admin.id },
    });
    const result = await checkFeedBan(event.id, user.id);
    expect(result).toBe('post');
  });

  it('returns "view" when user has both view and post bans (view is stricter)', async () => {
    const event = await seedEvent();
    const { user } = await createUser();
    const { user: admin } = await createUser({ email: 'admin@jdm.test', role: 'admin' });
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: user.id, scope: 'view', bannedById: admin.id },
    });
    await prisma.feedBan.create({
      data: { eventId: event.id, userId: user.id, scope: 'post', bannedById: admin.id },
    });
    const result = await checkFeedBan(event.id, user.id);
    expect(result).toBe('view');
  });

  it('does not cross events', async () => {
    const event1 = await seedEvent();
    const event2 = await prisma.event.create({
      data: {
        title: 'Other',
        slug: 'other',
        description: 'Other event',
        startsAt: new Date('2026-08-01T18:00:00Z'),
        endsAt: new Date('2026-08-01T22:00:00Z'),
        type: 'meeting',
        status: 'published',
        capacity: 100,
      },
    });
    const { user } = await createUser();
    const { user: admin } = await createUser({ email: 'admin@jdm.test', role: 'admin' });
    await prisma.feedBan.create({
      data: { eventId: event1.id, userId: user.id, scope: 'view', bannedById: admin.id },
    });
    const result = await checkFeedBan(event2.id, user.id);
    expect(result).toBeNull();
  });
});
