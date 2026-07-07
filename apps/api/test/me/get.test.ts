import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /me', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a bad signature', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current user for a valid token', async () => {
    const { user } = await createUser({ email: 'me@jdm.test', verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: user.id,
      email: 'me@jdm.test',
      role: 'user',
      bio: null,
      city: null,
      stateCode: null,
      avatarUrl: null,
    });
    expect(res.json()).not.toHaveProperty('passwordHash');
  });

  it('serializes staff users without validation errors', async () => {
    const { user } = await createUser({
      email: 'staff@jdm.test',
      verified: true,
      role: 'staff',
    });
    const env = loadEnv();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(env, user.id, 'staff') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: user.id,
      email: 'staff@jdm.test',
      role: 'staff',
    });
  });
});
