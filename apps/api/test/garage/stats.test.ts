import { prisma } from '@ccc/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { getGarageStats, GarageNotFoundError } from '../../src/services/garage/stats.js';
import { createUser, resetDatabase } from '../helpers.js';

const seedEvent = async (
  slug: string,
  overrides: { startsAt?: Date; status?: 'draft' | 'published' | 'cancelled' } = {},
) =>
  prisma.event.create({
    data: {
      slug,
      title: slug,
      description: 'd',
      startsAt: overrides.startsAt ?? new Date('2026-05-10T10:00:00Z'),
      endsAt: new Date(
        (overrides.startsAt ?? new Date('2026-05-10T10:00:00Z')).getTime() + 10 * 3600_000,
      ),
      type: 'meeting',
      status: overrides.status ?? 'published',
      capacity: 100,
      feedAccess: 'public',
      postingAccess: 'attendees',
    },
  });

describe('getGarageStats', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns zero counters + joinedAt for a fresh garage', async () => {
    const { user } = await createUser({ email: 'stats-fresh@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const stats = await getGarageStats(prisma, garage.id);

    expect(stats.events).toBe(0);
    expect(stats.posts).toBe(0);
    expect(stats.likesReceived).toBe(0);
    expect(stats.joinedAt).toBe(garage.createdAt.toISOString());
  });

  it('events counts DISTINCT attended events, not used tickets, AND filters by userId', async () => {
    const { user } = await createUser({ email: 'stats-events@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Second user — proves the `userId` filter; their `used` ticket MUST NOT be
    // counted toward `user`'s stats.
    const { user: other } = await createUser({
      email: 'stats-events-other@jdm.test',
      verified: true,
    });

    const e1 = await seedEvent('stats-evt-1', { startsAt: new Date('2026-04-01T10:00:00Z') });
    const e2 = await seedEvent('stats-evt-2', { startsAt: new Date('2026-04-15T10:00:00Z') });
    const tier1 = await prisma.ticketTier.create({
      data: { eventId: e1.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });
    const tier2 = await prisma.ticketTier.create({
      data: { eventId: e2.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });

    // 3 used by user across only TWO events (a guest at e1 twice over) + 1
    // valid + 1 revoked (excluded by status) + 1 used by `other` (excluded by
    // userId). A used-ticket count would say 3; attended events are 2.
    await prisma.ticket.createMany({
      data: [
        { userId: user.id, eventId: e1.id, tierId: tier1.id, status: 'used', usedAt: new Date() },
        { userId: user.id, eventId: e1.id, tierId: tier1.id, status: 'used', usedAt: new Date() },
        { userId: user.id, eventId: e2.id, tierId: tier2.id, status: 'used', usedAt: new Date() },
        { userId: user.id, eventId: e1.id, tierId: tier1.id, status: 'valid' },
        { userId: user.id, eventId: e1.id, tierId: tier1.id, status: 'revoked' },
        { userId: other.id, eventId: e1.id, tierId: tier1.id, status: 'used', usedAt: new Date() },
      ],
    });

    const stats = await getGarageStats(prisma, garage.id);
    expect(stats.events).toBe(2); // NOT 3 — the guest ticket at e1 is the same event.
    expect(stats.posts).toBe(0);
    expect(stats.likesReceived).toBe(0);
  });

  it('events counts a guest pair at one event as a single attended event', async () => {
    const { user } = await createUser({ email: 'stats-guest@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const event = await seedEvent('stats-guest-evt');
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
    });

    // The member brought one guest and both tickets were scanned.
    await prisma.ticket.createMany({
      data: [
        { userId: user.id, eventId: event.id, tierId: tier.id, status: 'used', usedAt: new Date() },
        { userId: user.id, eventId: event.id, tierId: tier.id, status: 'used', usedAt: new Date() },
      ],
    });

    const stats = await getGarageStats(prisma, garage.id);
    expect(stats.events).toBe(1);
  });

  it('events excludes used tickets on draft and not-yet-started events', async () => {
    const { user } = await createUser({ email: 'stats-unpub@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    const attended = await seedEvent('stats-unpub-ok', {
      startsAt: new Date('2026-04-01T10:00:00Z'),
    });
    const draft = await seedEvent('stats-unpub-draft', { status: 'draft' });
    const future = await seedEvent('stats-unpub-future', {
      startsAt: new Date('2099-01-01T10:00:00Z'),
    });

    for (const event of [attended, draft, future]) {
      const tier = await prisma.ticketTier.create({
        data: { eventId: event.id, name: 'GA', priceCents: 0, currency: 'BRL', quantityTotal: 100 },
      });
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventId: event.id,
          tierId: tier.id,
          status: 'used',
          usedAt: new Date(),
        },
      });
    }

    const stats = await getGarageStats(prisma, garage.id);
    expect(stats.events).toBe(1); // only the started published event.
  });

  it('posts count excludes hidden + removed + orphaned (authorUserId=null) rows', async () => {
    const { user } = await createUser({ email: 'stats-posts@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    const event = await seedEvent('stats-posts-evt');

    await prisma.feedPost.createMany({
      data: [
        { eventId: event.id, authorUserId: user.id, body: 'v1', status: 'visible' },
        { eventId: event.id, authorUserId: user.id, body: 'v2', status: 'visible' },
        {
          eventId: event.id,
          authorUserId: user.id,
          body: 'h',
          status: 'hidden',
          hiddenAt: new Date(),
        },
        // Authored by `user` but soft-deleted — must be excluded by status filter.
        { eventId: event.id, authorUserId: user.id, body: 'r', status: 'removed' },
        { eventId: event.id, authorUserId: null, body: 'orphan', status: 'visible' },
      ],
    });

    const stats = await getGarageStats(prisma, garage.id);
    expect(stats.posts).toBe(2); // only the two `visible` authored rows.
  });

  it('likesReceived comes from Garage column — divergent FeedReaction rows are ignored (§C4)', async () => {
    const { user } = await createUser({ email: 'stats-likes@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });

    // Bump the denormalized counter directly (chunk 27 will normally do this
    // via the like-awarder; we simulate by setting the column).
    await prisma.garage.update({
      where: { id: garage.id },
      data: { likesReceived: 7 },
    });

    // FeedReaction rows DISAGREE with the column (2 rows vs counter=7). §C4:
    // column wins — service must return 7.
    const event = await seedEvent('stats-likes-evt');
    const post = await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: user.id, body: 'p', status: 'visible' },
    });
    const { user: liker1 } = await createUser({ email: 'liker1@jdm.test', verified: true });
    const { user: liker2 } = await createUser({ email: 'liker2@jdm.test', verified: true });
    await prisma.feedReaction.createMany({
      data: [
        { postId: post.id, userId: liker1.id, kind: 'like' },
        { postId: post.id, userId: liker2.id, kind: 'like' },
      ],
    });

    const stats = await getGarageStats(prisma, garage.id);
    expect(stats.likesReceived).toBe(7); // column wins, not count(2)
  });

  it('does NOT touch prisma.feedReaction.* — column-direct (§C4)', async () => {
    const { user } = await createUser({ email: 'stats-no-agg@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.garage.update({ where: { id: garage.id }, data: { likesReceived: 3 } });

    // Proxy throws if `feedReaction` is accessed — structural §C4 assertion.
    const guardedPrisma = new Proxy(prisma, {
      get(target, prop, receiver): unknown {
        if (prop === 'feedReaction') {
          throw new Error('§C4 violation: getGarageStats accessed prisma.feedReaction');
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const stats = await getGarageStats(guardedPrisma, garage.id);
    expect(stats.likesReceived).toBe(3);
  });

  it('concurrent invocations return identical results (no shared state)', async () => {
    const { user } = await createUser({ email: 'stats-concurrent@jdm.test', verified: true });
    const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.garage.update({ where: { id: garage.id }, data: { likesReceived: 5 } });

    const event = await seedEvent('stats-conc-evt');
    await prisma.feedPost.create({
      data: { eventId: event.id, authorUserId: user.id, body: 'p', status: 'visible' },
    });

    const [a, b, c] = await Promise.all([
      getGarageStats(prisma, garage.id),
      getGarageStats(prisma, garage.id),
      getGarageStats(prisma, garage.id),
    ]);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.posts).toBe(1);
    expect(a.likesReceived).toBe(5);
  });

  it('throws GarageNotFoundError for an unknown garageId', async () => {
    await expect(getGarageStats(prisma, 'cuid-that-does-not-exist')).rejects.toBeInstanceOf(
      GarageNotFoundError,
    );
  });
});
