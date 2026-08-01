import { prisma } from '@ccc/db';
import { carSchema } from '@ccc/shared/cars';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('modifications array round-trip', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('persists and returns modifications array', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: {
        make: 'Subaru',
        model: 'Impreza',
        year: 2002,
        nickname: 'Prata',
        modifications: ['turbo upgrade', 'coilover'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = carSchema.parse(res.json());
    expect(body.modifications).toEqual(['turbo upgrade', 'coilover']);
  });

  it('PATCH updates modifications in place', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const car = await prisma.car.create({
      data: {
        userId: user.id,
        make: 'Mazda',
        model: 'MX5',
        year: 2005,
        nickname: 'Verde',
        modifications: ['roll bar'],
      },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${car.id}`,
      headers: { authorization: bearer(env, user.id) },
      payload: { modifications: ['roll bar', 'bucket seat'] },
    });
    expect(res.statusCode).toBe(200);
    const body = carSchema.parse(res.json());
    expect(body.modifications).toEqual(['roll bar', 'bucket seat']);
  });

  it('defaults modifications to empty array when omitted on create', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, user.id) },
      payload: { make: 'Honda', model: 'NSX', year: 1991, nickname: 'Branquelo' },
    });
    expect(res.statusCode).toBe(201);
    const body = carSchema.parse(res.json());
    expect(body.modifications).toEqual([]);
  });
});
