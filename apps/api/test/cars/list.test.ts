import { prisma } from '@jdm/db';
import { carListResponseSchema } from '@jdm/shared/cars';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /me/cars', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/cars' });
    expect(res.statusCode).toBe(401);
  });

  it('returns only the caller\u2019s cars, with photos', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const mine = await prisma.car.create({
      data: { userId: me.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'Cinza' },
    });
    await prisma.carPhoto.create({
      data: {
        carId: mine.id,
        objectKey: `car_photo/${me.id}/p1.jpg`,
        sortOrder: 0,
      },
    });
    await prisma.car.create({
      data: { userId: other.id, make: 'Toyota', model: 'Supra', year: 1998, nickname: 'Vermelho' },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, me.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = carListResponseSchema.parse(res.json());
    expect(body.cars).toHaveLength(1);
    expect(body.cars[0]).toMatchObject({ make: 'Honda', model: 'Civic', year: 1999 });
    expect(body.cars[0]?.photos).toHaveLength(1);
    expect(body.cars[0]?.photos[0]?.url).toMatch(/^https?:\/\/.+car_photo\//);
    expect(body.cars[0]?.photo).toBeTruthy();
    expect(body.cars[0]?.photo?.url).toMatch(/^https?:\/\/.+car_photo\//);
  });

  it('returns photo as null when car has no photos', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'S2000', year: 2004, nickname: 'S2K' },
    });

    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = carListResponseSchema.parse(res.json());
    expect(body.cars[0]?.photo).toBeNull();
    expect(body.cars[0]?.photos).toHaveLength(0);
  });
});
