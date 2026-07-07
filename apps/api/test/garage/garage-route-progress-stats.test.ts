import { prisma } from '@jdm/db';
import { garageReadSchema } from '@jdm/shared/garage';
import { garagePublicResponseSchema } from '@jdm/shared/garage-public';
import { GENERAL_SETTINGS_SINGLETON_ID } from '@jdm/shared/general-settings';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const setGamificationEnabled = async (enabled: boolean) => {
  await prisma.generalSettings.upsert({
    where: { id: GENERAL_SETTINGS_SINGLETON_ID },
    update: { gamificationEnabled: enabled },
    create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: enabled },
  });
};

// Mirrors apps/api/test/garage/stats.test.ts: Event requires description +
// EventType is `meeting` (not `meet`); TicketTier uses quantityTotal (not
// capacity); FeedPost requires eventId + uses status `visible`. Plan's inline
// helpers used outdated field names — corrected here.
const seedEvent = (slug: string) =>
  prisma.event.create({
    data: {
      slug,
      title: slug,
      description: 'd',
      startsAt: new Date(Date.now() - 2 * 3600_000),
      endsAt: new Date(Date.now() + 2 * 3600_000),
      type: 'meeting',
      status: 'published',
      capacity: 50,
      feedAccess: 'public',
    },
  });

const seedUsedTicket = async (userId: string) => {
  const event = await seedEvent(`evt-${userId.slice(0, 6)}`);
  const tier = await prisma.ticketTier.create({
    data: { eventId: event.id, name: 'Geral', priceCents: 0, quantityTotal: 50 },
  });
  await prisma.ticket.create({
    data: {
      eventId: event.id,
      tierId: tier.id,
      userId,
      status: 'used',
      usedAt: new Date(),
    },
  });
};

const seedVisiblePost = async (userId: string) => {
  const event = await seedEvent(`evt-post-${userId.slice(0, 6)}`);
  await prisma.feedPost.create({
    data: {
      eventId: event.id,
      authorUserId: userId,
      body: 'visible',
      status: 'visible',
    },
  });
};

describe('garage routes — progress + stats payload (chunk 28)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const getOwner = (userId: string) => {
    const env = loadEnv();
    return app.inject({
      method: 'GET',
      url: '/me/garage',
      headers: { authorization: bearer(env, userId) },
    });
  };

  describe('GET /me/garage', () => {
    it('owner: returns progress + stats when killswitch is on', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      const res = await getOwner(user.id);
      const body = garageReadSchema.parse(res.json());

      // Fresh garage but owner ALWAYS renders both when killswitch is on.
      expect(body.gamification.enabled).toBe(true);
      expect(body.progress).toEqual({
        xp: 0,
        rank: 'Iniciante',
        nextRank: 'Pilotador',
        xpInTier: 0,
        xpToNextRank: 100,
        tierSpan: 100,
      });
      expect(body.stats).toMatchObject({ events: 0, posts: 0, likesReceived: 0 });
      expect(typeof body.stats!.joinedAt).toBe('string');
    });

    it('owner: omits progress + stats when killswitch is off', async () => {
      await setGamificationEnabled(false);
      const { user } = await createUser({ verified: true });
      const res = await getOwner(user.id);
      const body = garageReadSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(false);
      expect(body.progress).toBeUndefined();
      expect(body.stats).toBeUndefined();
    });
  });

  describe('GET /g/:slug', () => {
    const publishGarage = (userId: string, slug: string, extra: Record<string, unknown> = {}) =>
      prisma.garage.update({
        where: { userId },
        data: { slug, isPublic: true, ...extra },
      });

    it('public: omits progress + stats when all metrics are zero (hide-on-empty)', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'empty-public');
      const res = await app.inject({ method: 'GET', url: '/g/empty-public' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(true);
      expect(body.progress).toBeUndefined();
      expect(body.stats).toBeUndefined();
    });

    it('public: returns progress + stats when xp > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-xp', { xp: 42 });
      const res = await app.inject({ method: 'GET', url: '/g/has-xp' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(true);
      expect(body.progress!.xp).toBe(42);
      expect(body.progress!.rank).toBe('Iniciante');
      expect(body.stats!.events).toBe(0);
      expect(body.stats!.posts).toBe(0);
      expect(body.stats!.likesReceived).toBe(0);
    });

    it('public: returns progress + stats when likesReceived > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-likes', { likesReceived: 3 });
      const res = await app.inject({ method: 'GET', url: '/g/has-likes' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.progress).toBeDefined();
      expect(body.stats!.likesReceived).toBe(3);
    });

    it('public: returns progress + stats when events > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-events');
      await seedUsedTicket(user.id);
      const res = await app.inject({ method: 'GET', url: '/g/has-events' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.progress!.xp).toBe(0);
      expect(body.stats!.events).toBe(1);
      expect(body.stats!.posts).toBe(0);
      expect(body.stats!.likesReceived).toBe(0);
    });

    it('public: returns progress + stats when posts > 0', async () => {
      await setGamificationEnabled(true);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'has-posts');
      await seedVisiblePost(user.id);
      const res = await app.inject({ method: 'GET', url: '/g/has-posts' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.progress).toBeDefined();
      expect(body.stats!.events).toBe(0);
      expect(body.stats!.posts).toBe(1);
      expect(body.stats!.likesReceived).toBe(0);
    });

    it('public: omits progress + stats when killswitch is off (overrides hide-on-empty)', async () => {
      await setGamificationEnabled(false);
      const { user } = await createUser({ verified: true });
      await publishGarage(user.id, 'killed', { xp: 42 });
      const res = await app.inject({ method: 'GET', url: '/g/killed' });
      const body = garagePublicResponseSchema.parse(res.json());
      expect(body.gamification.enabled).toBe(false);
      expect(body.progress).toBeUndefined();
      expect(body.stats).toBeUndefined();
    });
  });
});
