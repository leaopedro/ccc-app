import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('DELETE /me/cars/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes the car and cascades photos', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Nissan', model: 'Skyline', year: 1999, nickname: 'GTR' },
    });
    await prisma.carPhoto.create({
      data: { carId: car.id, objectKey: `car_photo/${user.id}/x.jpg` },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.car.count()).toBe(0);
    expect(await prisma.carPhoto.count()).toBe(0);
  });

  it('returns 404 for missing car', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: '/me/cars/nonexistent',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when car belongs to someone else', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const theirs = await prisma.car.create({
      data: { userId: other.id, make: 'Honda', model: 'NSX', year: 1991, nickname: 'NSX' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/cars/${theirs.id}`,
      headers: { authorization: bearer(env, me.id) },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.car.count()).toBe(1); // their car must survive
  });
});
