import { prisma } from '@jdm/db';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { issueEmailChangeToken } from '../../src/services/auth/email-change.js';
import type { DevMailer } from '../../src/services/mailer/dev.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /me/email-change', () => {
  let app: FastifyInstance;
  const env = loadEnv();

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends confirmation email to new address and returns 202', async () => {
    const { user } = await createUser({ email: 'original@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change',
      headers: { authorization: bearer(env, user.id) },
      payload: { newEmail: 'new@jdm.test' },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ message: 'confirmation email sent' });

    const token = await prisma.emailChangeToken.findFirst({
      where: { userId: user.id, consumedAt: null },
    });
    expect(token).not.toBeNull();
    expect(token?.pendingEmail).toBe('new@jdm.test');

    const mail = (app.mailer as DevMailer).find('new@jdm.test');
    expect(mail).toBeDefined();
    expect(mail?.subject).toContain('confirme seu novo e-mail');
    expect(mail?.html).toContain('/verify-email-change?token=');
  });

  it('rejects when new email already in use', async () => {
    const { user } = await createUser({ email: 'original@jdm.test', verified: true });
    await createUser({ email: 'taken@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change',
      headers: { authorization: bearer(env, user.id) },
      payload: { newEmail: 'taken@jdm.test' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects when new email is the same as current', async () => {
    const { user } = await createUser({ email: 'same@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change',
      headers: { authorization: bearer(env, user.id) },
      payload: { newEmail: 'same@jdm.test' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change',
      payload: { newEmail: 'new@jdm.test' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /me/email-change/verify', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    (app.mailer as DevMailer).clear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('swaps email, revokes refresh tokens, notifies old email', async () => {
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });

    await prisma.refreshToken.createMany({
      data: [
        {
          userId: user.id,
          tokenHash: `rt-a-${user.id}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
        {
          userId: user.id,
          tokenHash: `rt-b-${user.id}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ],
    });

    const token = await issueEmailChangeToken(user.id, 'new@jdm.test');

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ message: 'email updated' });

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.email).toBe('new@jdm.test');
    expect(updated?.emailVerifiedAt).not.toBeNull();

    const liveTokens = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(liveTokens).toBe(0);

    const notifyMail = (app.mailer as DevMailer).find('old@jdm.test');
    expect(notifyMail).toBeDefined();
    expect(notifyMail?.subject).toContain('seu e-mail foi alterado');
    expect(notifyMail?.html).toContain('new@jdm.test');
  });

  it('rejects stale (expired) token', async () => {
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });
    const token = await issueEmailChangeToken(user.id, 'new@jdm.test');

    await prisma.emailChangeToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects reused token', async () => {
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });
    const token = await issueEmailChangeToken(user.id, 'new@jdm.test');

    await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects token when target email is taken by the time of verify', async () => {
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });
    const token = await issueEmailChangeToken(user.id, 'raced@jdm.test');

    // Another user registers with the same target email before verification
    await createUser({ email: 'raced@jdm.test', verified: true });

    const res = await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token },
    });

    expect(res.statusCode).toBe(400);
  });

  it('invalidates access tokens issued before email swap', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });

    const staleIat = Math.floor(Date.now() / 1000) - 5;
    const preSwapJwt = jwt.sign(
      { sub: user.id, role: 'user', iat: staleIat },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: 900 },
    );

    const changeToken = await issueEmailChangeToken(user.id, 'new@jdm.test');
    await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token: changeToken },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${preSwapJwt}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: 'session invalidated' });
  });

  it('rejects access token issued in the same second as email swap', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });

    const changeToken = await issueEmailChangeToken(user.id, 'new@jdm.test');
    await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token: changeToken },
    });

    // Read the exact tokenInvalidatedAt and craft a JWT with iat in the same second
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const sameSecondIat = Math.floor(updated.tokenInvalidatedAt!.getTime() / 1000);
    const sameSecondJwt = jwt.sign(
      { sub: user.id, role: 'user', iat: sameSecondIat },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: 900 },
    );

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${sameSecondJwt}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: 'session invalidated' });
  });

  it('accepts access token issued after the email swap second', async () => {
    const env = loadEnv();
    const { user } = await createUser({ email: 'old@jdm.test', verified: true });

    const changeToken = await issueEmailChangeToken(user.id, 'new@jdm.test');
    await app.inject({
      method: 'POST',
      url: '/me/email-change/verify',
      payload: { token: changeToken },
    });

    // Read the exact tokenInvalidatedAt and craft a JWT one second after
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const afterSwapIat = Math.floor(updated.tokenInvalidatedAt!.getTime() / 1000) + 1;
    const freshJwt = jwt.sign(
      { sub: user.id, role: 'user', iat: afterSwapIat },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: 900 },
    );

    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${freshJwt}` },
    });

    expect(res.statusCode).toBe(200);
  });
});
