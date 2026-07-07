import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('nickname uniqueness', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 409 with error=nickname_taken when nickname already exists', async () => {
    const { user: u1 } = await createUser({ email: 'a@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'b@jdm.test', verified: true });
    const env = loadEnv();

    // u1 creates car with nickname 'Raio'
    await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u1.id) },
      payload: { make: 'Honda', model: 'Civic', year: 2000, nickname: 'Raio' },
    });

    // u2 tries the same nickname
    const res = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u2.id) },
      payload: { make: 'Toyota', model: 'Supra', year: 1998, nickname: 'Raio' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'nickname_taken' });
  });

  it('returns 409 on PATCH when renaming to a taken nickname', async () => {
    const { user: u1 } = await createUser({ email: 'c@jdm.test', verified: true });
    const { user: u2 } = await createUser({ email: 'd@jdm.test', verified: true });
    const env = loadEnv();

    await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u1.id) },
      payload: { make: 'Mazda', model: 'RX7', year: 1993, nickname: 'Rex' },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/me/cars',
      headers: { authorization: bearer(env, u2.id) },
      payload: { make: 'Subaru', model: 'WRX', year: 2004, nickname: 'Azul' },
    });
    const createdBody: { id: string } = created.json();
    const carId = createdBody.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/me/cars/${carId}`,
      headers: { authorization: bearer(env, u2.id) },
      payload: { nickname: 'Rex' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'nickname_taken' });
  });
});
