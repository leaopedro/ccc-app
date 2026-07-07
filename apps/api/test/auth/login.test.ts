import { authResponseSchema } from '@jdm/shared/auth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createUser, makeApp, resetDatabase } from '../helpers.js';

const errorResponseSchema = z.object({ error: z.string(), message: z.string().optional() });

describe('POST /auth/login', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns tokens and user on success', async () => {
    const { user, password } = await createUser({ email: 'login@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password },
    });
    expect(res.statusCode).toBe(200);
    const body = authResponseSchema.parse(res.json());
    expect(body.user.email).toBe('login@jdm.test');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('rejects bad passwords', async () => {
    await createUser({ email: 'a@jdm.test', verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@jdm.test', password: 'x'.repeat(10) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unverified users', async () => {
    const { user, password } = await createUser({ email: 'nv@jdm.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password },
    });
    expect(res.statusCode).toBe(403);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error).toBe('EmailNotVerified');
  });

  it('rejects unknown users with the same 401 shape as bad passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@jdm.test', password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(401);
  });
});
