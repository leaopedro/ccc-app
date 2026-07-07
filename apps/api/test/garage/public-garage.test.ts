import { prisma } from '@jdm/db';
import { garagePublicResponseSchema } from '@jdm/shared/garage-public';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /g/:slug', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the public profile when isPublic=true', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: {
        slug: 'visible-jdm',
        isPublic: true,
        description: 'Antigos',
        name: 'Garagem Pública',
      },
    });
    await prisma.car.create({
      data: {
        userId: user.id,
        make: 'Toyota',
        model: 'Supra',
        year: 1998,
        nickname: 'Branco',
        modifications: ['turbo'],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/g/visible-jdm' });
    expect(res.statusCode).toBe(200);
    const body = garagePublicResponseSchema.parse(res.json());
    expect(body.garage.name).toBe('Garagem Pública');
    expect(body.garage.slug).toBe('visible-jdm');
    expect(body.garage.description).toBe('Antigos');
    expect(body.garage.isPremiumActive).toBe(false);
    expect(body.cars).toHaveLength(1);
    expect(body.cars[0]!.nickname).toBe('Branco');
    // §15.6 capability flag carries through the public payload too. New
    // garage has no pinned badges, so the array is empty.
    expect(body.garage.gamification.enabled).toBe(true);
    expect(body.garage.badges).toEqual([]);

    // Forbidden fields must not leak in the raw JSON.
    const raw = res.json<{ garage: Record<string, unknown> }>();
    expect('id' in raw.garage).toBe(false);
    expect('userId' in raw.garage).toBe(false);
    expect('premiumUntil' in raw.garage).toBe(false);
    expect('createdAt' in raw.garage).toBe(false);
    expect('updatedAt' in raw.garage).toBe(false);
  });

  it('returns 404 when slug resolves to a private garage (indistinguishable from unknown slug)', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: { slug: 'hidden-jdm', isPublic: false },
    });
    const privateRes = await app.inject({ method: 'GET', url: '/g/hidden-jdm' });
    const unknownRes = await app.inject({ method: 'GET', url: '/g/never-existed' });
    expect(privateRes.statusCode).toBe(404);
    expect(unknownRes.statusCode).toBe(404);
    expect(privateRes.json()).toEqual(unknownRes.json());
  });

  it('computes isPremiumActive correctly via the serializer', async () => {
    const { user: a } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: b } = await createUser({ email: 'b@jdm.test', verified: true });
    const { user: c } = await createUser({ email: 'c@jdm.test', verified: true });
    const { user: d } = await createUser({ email: 'd@jdm.test', verified: true });

    // a: null tier → false
    await prisma.garage.update({
      where: { userId: a.id },
      data: { slug: 'a-gar', isPublic: true, premiumTier: null, premiumUntil: null },
    });
    // b: non-null tier + null premiumUntil → true (perpetual)
    await prisma.garage.update({
      where: { userId: b.id },
      data: { slug: 'b-gar', isPublic: true, premiumTier: 'gold', premiumUntil: null },
    });
    // c: non-null tier + future premiumUntil → true
    await prisma.garage.update({
      where: { userId: c.id },
      data: {
        slug: 'c-gar',
        isPublic: true,
        premiumTier: 'silver',
        premiumUntil: new Date(Date.now() + 86_400_000),
      },
    });
    // d: non-null tier + past premiumUntil → false (lapsed)
    await prisma.garage.update({
      where: { userId: d.id },
      data: {
        slug: 'd-gar',
        isPublic: true,
        premiumTier: 'bronze',
        premiumUntil: new Date(Date.now() - 86_400_000),
      },
    });

    const get = async (slug: string) => {
      const res = await app.inject({ method: 'GET', url: `/g/${slug}` });
      expect(res.statusCode).toBe(200);
      return garagePublicResponseSchema.parse(res.json());
    };

    expect((await get('a-gar')).garage.isPremiumActive).toBe(false);
    expect((await get('b-gar')).garage.isPremiumActive).toBe(true);
    expect((await get('c-gar')).garage.isPremiumActive).toBe(true);
    expect((await get('d-gar')).garage.isPremiumActive).toBe(false);
  });
});
