import { prisma } from '@ccc/db';
import { carSchema } from '@ccc/shared/cars';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('PATCH /me/cars/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('updates the caller\u2019s car', async () => {
    const { user } = await createUser({ verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Mazda', model: 'RX7', year: 1993, nickname: 'Mazda RX7' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
      payload: { nickname: 'FD3S' },
    });
    expect(res.statusCode).toBe(200);
    const body = carSchema.parse(res.json());
    expect(body.nickname).toBe('FD3S');
  });

  it('returns 404 when car belongs to someone else', async () => {
    const { user: me } = await createUser({ email: 'me@jdm.test', verified: true });
    const { user: other } = await createUser({ email: 'o@jdm.test', verified: true });
    const theirs = await prisma.car.create({
      data: { userId: other.id, make: 'Honda', model: 'NSX', year: 1991, nickname: 'Honda NSX' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${theirs.id}`,
      headers: { authorization: bearer(env, me.id) },
      payload: { nickname: 'sneaky' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('silently ignores the dropped description field on update', async () => {
    // Post-pivot: Car.description no longer exists. PATCH /me/cars/:id is not
    // strict, so legacy clients posting `description` succeed but the field
    // is dropped at the Zod boundary and never lands on the DB row.
    const { user } = await createUser({ email: 'desc@jdm.test', verified: true });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1998, nickname: 'Lento' },
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
      payload: { description: 'Carro de família', nickname: 'NovoNick' },
    });
    expect(res.statusCode).toBe(200);
    const body = carSchema.parse(res.json());
    expect(body.nickname).toBe('NovoNick');
    expect((body as Record<string, unknown>).description).toBeUndefined();
  });
});
