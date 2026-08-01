import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { GENERAL_SETTINGS_SINGLETON_ID } from '../../src/services/garage/killswitch.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const garageIdForUser = async (userId: string): Promise<string> => {
  const g = await prisma.garage.findUniqueOrThrow({ where: { userId } });
  return g.id;
};

const carPayload = (nickname: string) => ({
  make: 'Honda',
  model: 'Civic',
  year: 1999,
  nickname,
  modifications: [],
});

describe('XP awarder hook — POST /me/cars awards +5 per car_create', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('single POST /me/cars writes one XpEvent (+5) and Garage.xp = 5', async () => {
    const { user } = await createUser({ email: 'xp-cars-1@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: carPayload('xp civic 1'),
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageIdForUser(user.id);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt).toMatchObject({ reason: 'car_create', delta: 5 });
    expect(evt?.sourceRef).toMatch(/^car:/);

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(5);
  });

  it('three POSTs write three XpEvent rows totalling +15 — distinct sourceRefs per carId', async () => {
    const { user } = await createUser({ email: 'xp-cars-3@jdm.test', verified: true });
    const env = loadEnv();

    for (const nick of ['car a', 'car b', 'car c']) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/cars',
        headers: { authorization: bearer(env, user.id) },
        payload: carPayload(nick),
      });
      expect(res.statusCode).toBe(201);
    }

    const gid = await garageIdForUser(user.id);
    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'car_create' },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.delta === 5)).toBe(true);
    const refs = events.map((e) => e.sourceRef);
    expect(new Set(refs).size).toBe(3); // all distinct

    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(15);
  });

  it('replay-style: pre-seeded XpEvent makes the second car_create call a no-op (idempotent)', async () => {
    const { user } = await createUser({ email: 'xp-cars-idemp@jdm.test', verified: true });
    const env = loadEnv();

    // First car succeeds + awards normally.
    const first = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: carPayload('idemp one'),
    });
    expect(first.statusCode).toBe(201);
    const firstCar = JSON.parse(first.payload) as { id: string };

    const gid = await garageIdForUser(user.id);

    // Simulate a replay: directly invoke awardXp again with the SAME triple.
    // Chunk 27 guarantees the second call returns { awarded: false } via
    // P2002 catch; row count stays at 1, Garage.xp stays at 5.
    const { awardXp } = await import('../../src/services/garage/xp-awarder.js');
    const replay = await prisma.$transaction(async (tx) =>
      awardXp(tx, gid, 'car_create', { sourceRef: `car:${firstCar.id}` }),
    );
    expect(replay.awarded).toBe(false);

    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'car_create' },
    });
    expect(events).toHaveLength(1);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(5);
  });

  it('killswitch off: car is created but no XpEvent row is written and Garage.xp stays 0', async () => {
    // Ensure GeneralSettings exists with gamificationEnabled = false.
    // Singleton id is the string constant from killswitch.ts (canon §8).
    await prisma.generalSettings.upsert({
      where: { id: GENERAL_SETTINGS_SINGLETON_ID },
      update: { gamificationEnabled: false },
      create: { id: GENERAL_SETTINGS_SINGLETON_ID, gamificationEnabled: false },
    });

    const { user } = await createUser({ email: 'xp-cars-killsw@jdm.test', verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: carPayload('kill civic'),
    });
    expect(res.statusCode).toBe(201);

    const gid = await garageIdForUser(user.id);
    const events = await prisma.xpEvent.findMany({ where: { garageId: gid } });
    expect(events).toHaveLength(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(0);

    // Confirm the car itself did land — the killswitch must NEVER block the
    // user's primary action, only the awarder side-effect.
    const cars = await prisma.car.findMany({ where: { userId: user.id } });
    expect(cars).toHaveLength(1);
  });

  it('parent tx rollback: throw AFTER awardXp inside a manual tx leaves zero XpEvent rows and Garage.xp === 0', async () => {
    // Deterministic rollback proof: invoke awardXp inside a $transaction,
    // then throw immediately after to abort the tx. Asserts that the
    // awarder's XpEvent insert + Garage.xp increment both undo with the
    // parent tx — i.e. awardXp is honestly transactional via its `tx`
    // parameter (canon §5). Uses a manual tx (not the route) because the
    // route never throws after the awardXp call in practice.
    const { user } = await createUser({ email: 'xp-cars-rollback@jdm.test', verified: true });
    const gid = await garageIdForUser(user.id);
    const { awardXp } = await import('../../src/services/garage/xp-awarder.js');

    await expect(
      prisma.$transaction(async (tx) => {
        const result = await awardXp(tx, gid, 'car_create', {
          sourceRef: 'car:rollback-test',
        });
        expect(result.awarded).toBe(true);
        throw new Error('forced rollback after awardXp');
      }),
    ).rejects.toThrow('forced rollback after awardXp');

    const events = await prisma.xpEvent.findMany({
      where: { garageId: gid, reason: 'car_create' },
    });
    expect(events).toHaveLength(0);
    const garage = await prisma.garage.findUniqueOrThrow({ where: { id: gid } });
    expect(garage.xp).toBe(0);
  });
});
