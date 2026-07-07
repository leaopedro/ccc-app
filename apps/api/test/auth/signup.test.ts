import { prisma } from '@jdm/db';
import { authResponseSchema } from '@jdm/shared/auth';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DevMailer } from '../../src/services/mailer/dev.js';
import { makeApp, resetDatabase } from '../helpers.js';

describe('POST /auth/signup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a user and sends a verification email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'new@jdm.test', password: 'correct-horse-battery-staple', name: 'New' },
    });
    expect(res.statusCode).toBe(201);
    const body = authResponseSchema.parse(res.json());
    expect(body.user.email).toBe('new@jdm.test');
    expect(body.user.emailVerifiedAt).toBeNull();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');

    const saved = await prisma.user.findUnique({ where: { email: 'new@jdm.test' } });
    expect(saved?.passwordHash).not.toBeNull();

    const captured = (app.mailer as DevMailer).find('new@jdm.test');
    expect(captured?.subject).toMatch(/verifique/i);
    expect(captured?.html).toContain('/verify?token=');
  });

  it('rejects duplicate emails', async () => {
    const payload = {
      email: 'dup@jdm.test',
      password: 'correct-horse-battery-staple',
      name: 'Dup',
    };
    const first = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/auth/signup', payload });
    expect(second.statusCode).toBe(409);
  });

  it('rejects weak passwords', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'weak@jdm.test', password: 'short', name: 'Weak' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('normalizes email casing', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'Alice@JDM.Test', password: 'correct-horse-battery-staple', name: 'Alice' },
    });
    const saved = await prisma.user.findUnique({ where: { email: 'alice@jdm.test' } });
    expect(saved).not.toBeNull();
  });
});
