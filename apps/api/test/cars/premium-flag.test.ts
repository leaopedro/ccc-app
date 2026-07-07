import { prisma } from '@jdm/db';
import { carListResponseSchema } from '@jdm/shared/cars';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

// Covers the serializer threading added by TASK-E: every car payload exposes
// the owner's garage `isPremiumActive` flag, computed server-side from
// premiumTier + premiumUntil. See spec §2.1 and computeIsPremiumActive.
describe('GET /me/cars isPremiumActive flag', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns false for a garage with no premium tier', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 2010, nickname: 'Cinza' },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = carListResponseSchema.parse(res.json());
    expect(body.cars[0]?.isPremiumActive).toBe(false);
  });

  it('returns true when garage has a tier and no premiumUntil', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.garage.update({
      where: { userId: user.id },
      data: { premiumTier: 'gold', premiumUntil: null },
    });
    await prisma.car.create({
      data: { userId: user.id, make: 'Toyota', model: 'Supra', year: 1998, nickname: 'Branca' },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
    });
    const body = carListResponseSchema.parse(res.json());
    expect(body.cars[0]?.isPremiumActive).toBe(true);
  });

  it('returns true when premiumUntil is in the future', async () => {
    const { user } = await createUser({ verified: true });
    const future = new Date(Date.now() + 7 * 86_400_000);
    await prisma.garage.update({
      where: { userId: user.id },
      data: { premiumTier: 'silver', premiumUntil: future },
    });
    await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1992, nickname: 'FD3S' },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
    });
    const body = carListResponseSchema.parse(res.json());
    expect(body.cars[0]?.isPremiumActive).toBe(true);
  });

  it('returns false when premiumUntil has lapsed', async () => {
    const { user } = await createUser({ verified: true });
    const past = new Date(Date.now() - 86_400_000);
    await prisma.garage.update({
      where: { userId: user.id },
      data: { premiumTier: 'bronze', premiumUntil: past },
    });
    await prisma.car.create({
      data: { userId: user.id, make: 'Nissan', model: 'Skyline', year: 1995, nickname: 'GTR' },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
    });
    const body = carListResponseSchema.parse(res.json());
    expect(body.cars[0]?.isPremiumActive).toBe(false);
  });
});
