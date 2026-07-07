import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp, resetDatabase } from '../helpers.js';

describe('auth rate limit', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 429 after 10 login attempts from the same (ip,email)', async () => {
    const payload = { email: 'rl@jdm.test', password: 'correct-horse-battery-staple' };
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/auth/login', payload });
      expect(res.statusCode).toBe(401);
    }
    const res11 = await app.inject({ method: 'POST', url: '/auth/login', payload });
    expect(res11.statusCode).toBe(429);
  });
});
