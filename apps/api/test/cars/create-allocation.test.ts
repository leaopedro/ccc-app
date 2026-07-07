import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { reconcileGarageSpots } from '../../src/services/garage/index.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const setCap = async (cap: number | null) => {
  await prisma.generalSettings.upsert({
    where: { id: 'general_default' },
    update: { defaultFreeGarageSpots: cap },
    create: { id: 'general_default', defaultFreeGarageSpots: cap },
  });
};

describe('POST /me/cars — spot allocation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('mints a default_free spot for a fresh bounded-cap user (no prior reconcile)', async () => {
    // Signup creates User + Garage but no GarageSpot rows. With a bounded
    // cap, the allocator must self-heal by minting a default_free spot
    // when freeFilled < freeLimit. Without this, fresh signup → first car
    // → GARAGE_FULL even though the user has free quota.
    await setCap(1);
    const { user } = await createUser({ verified: true });
    // Intentionally NO reconcileGarageSpots call.
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
    });
    expect(res.statusCode).toBe(201);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]!.source).toBe('default_free');
    expect(spots[0]!.carId).not.toBeNull();
  });

  it('claims a default_free spot when one is available', async () => {
    await setCap(1);
    const { user } = await createUser({ verified: true });
    await reconcileGarageSpots(user.id);
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
    });
    expect(res.statusCode).toBe(201);
    const spot = await prisma.garageSpot.findFirst({ where: { userId: user.id } });
    expect(spot).not.toBeNull();
    expect(spot!.source).toBe('default_free');
    expect(spot!.carId).not.toBeNull();
  });

  it('claims an extra spot when no default_free spot is empty', async () => {
    await setCap(1);
    const { user } = await createUser({ verified: true });
    await reconcileGarageSpots(user.id);
    await prisma.garageSpot.create({
      data: { userId: user.id, source: 'purchase' },
    });
    const env = loadEnv();
    // First car consumes the default_free spot.
    const first = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
    });
    expect(first.statusCode).toBe(201);
    // Second car must consume the purchased extra.
    const second = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Honda', model: 'NSX', year: 1991, nickname: 'NA1' },
    });
    expect(second.statusCode).toBe(201);

    const secondBody = second.json<{ id: string }>();
    const secondSpot = await prisma.garageSpot.findUnique({
      where: { carId: secondBody.id },
    });
    expect(secondSpot!.source).toBe('purchase');
  });

  it('returns 409 GARAGE_FULL when no spots are available', async () => {
    await setCap(1);
    const { user } = await createUser({ verified: true });
    await reconcileGarageSpots(user.id);
    const env = loadEnv();
    const first = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Honda', model: 'NSX', year: 1991, nickname: 'NA1' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ code: string }>().code).toBe('GARAGE_FULL');
    const cars = await prisma.car.count({ where: { userId: user.id } });
    expect(cars).toBe(1); // second car must not exist — atomic rollback
  });

  it('mints a new default_free spot on demand when cap is null (unlimited)', async () => {
    await setCap(null);
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
    });
    expect(res.statusCode).toBe(201);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]!.source).toBe('default_free');
    expect(spots[0]!.carId).not.toBeNull();
  });

  it('atomically settles a concurrent add — winner gets the spot, loser sees 409', async () => {
    await setCap(1);
    const { user } = await createUser({ verified: true });
    await reconcileGarageSpots(user.id);
    const env = loadEnv();
    const token = bearer(env, user.id);
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: { authorization: token },
        payload: { make: 'Mazda', model: 'RX-7', year: 1993, nickname: 'FD' },
      }),
      app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: { authorization: token },
        payload: { make: 'Honda', model: 'NSX', year: 1991, nickname: 'NA1' },
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    expect(codes).toEqual([201, 409]);
    const fullResponse = a.statusCode === 409 ? a : b;
    expect(fullResponse.json<{ code: string }>().code).toBe('GARAGE_FULL');
    const cars = await prisma.car.count({ where: { userId: user.id } });
    expect(cars).toBe(1);
    const spots = await prisma.garageSpot.findMany({ where: { userId: user.id } });
    expect(spots).toHaveLength(1);
    expect(spots[0]!.carId).not.toBeNull();
  });
});
