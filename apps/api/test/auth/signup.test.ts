import { TERMS_VERSION } from '@ccc/shared/terms';
import { prisma } from '@ccc/db';
import { authResponseSchema } from '@ccc/shared/auth';
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
      payload: {
        email: 'new@jdm.test',
        password: 'correct-horse-battery-staple',
        name: 'New',
        ageAttestation: true,
        termsVersion: TERMS_VERSION,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = authResponseSchema.parse(res.json());
    expect(body.user.email).toBe('new@jdm.test');
    expect(body.user.emailVerifiedAt).toBeNull();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');

    const saved = await prisma.user.findUnique({ where: { email: 'new@jdm.test' } });
    expect(saved?.passwordHash).not.toBeNull();
    expect(saved?.ageAttestedAt).not.toBeNull();

    const captured = (app.mailer as DevMailer).find('new@jdm.test');
    expect(captured?.subject).toMatch(/verifique/i);
    expect(captured?.html).toContain('/verify?token=');
  });

  it('refuses a signup that does not accept the terms', async () => {
    // The API used to stamp User.termsVersion unconditionally while the payload
    // carried no acceptance at all, so the database recorded a consent nobody
    // gave: a direct client could create an account without ever seeing the
    // terms and still look like it agreed.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: 'sem-termos@jdm.test',
        name: 'Sem Termos',
        password: 'correct-horse-battery-staple',
        ageAttestation: true,
      },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.findUnique({ where: { email: 'sem-termos@jdm.test' } })).toBeNull();
  });

  it('rejects duplicate emails', async () => {
    const payload = {
      email: 'dup@jdm.test',
      password: 'correct-horse-battery-staple',
      name: 'Dup',
      ageAttestation: true,
      termsVersion: TERMS_VERSION,
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
      payload: {
        email: 'Alice@JDM.Test',
        password: 'correct-horse-battery-staple',
        name: 'Alice',
        ageAttestation: true,
        termsVersion: TERMS_VERSION,
      },
    });
    const saved = await prisma.user.findUnique({ where: { email: 'alice@jdm.test' } });
    expect(saved).not.toBeNull();
  });

  it('rejects signup without the 18+ attestation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'minor@jdm.test', password: 'correct-horse-battery-staple', name: 'Minor' },
    });
    expect(res.statusCode).toBe(400);
    const saved = await prisma.user.findUnique({ where: { email: 'minor@jdm.test' } });
    expect(saved).toBeNull();
  });
});
