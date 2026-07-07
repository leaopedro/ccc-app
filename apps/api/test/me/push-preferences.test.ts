import { prisma } from '@jdm/db';
import { pushPrefsSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { recordConsent } from '../../src/services/consent.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('/me/push-preferences', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the current push preferences (marketing defaults false)', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'GET',
      url: '/me/push-preferences',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(200);
    expect(pushPrefsSchema.parse(res.json())).toEqual({
      transactional: true,
      marketing: false,
    });
  });

  it('updates only the marketing preference and creates a consent row', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/push-preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { marketing: true },
    });

    expect(res.statusCode).toBe(200);
    expect(pushPrefsSchema.parse(res.json())).toEqual({
      transactional: true,
      marketing: true,
    });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { pushPrefs: true },
    });

    expect(pushPrefsSchema.parse(row.pushPrefs)).toEqual({
      transactional: true,
      marketing: true,
    });

    const consent = await prisma.consent.findFirst({
      where: { userId: user.id, purpose: 'push_marketing', withdrawnAt: null },
    });
    expect(consent).not.toBeNull();
  });

  it('withdraws consent when marketing is set to false', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    await app.inject({
      method: 'PATCH',
      url: '/me/push-preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { marketing: true },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/push-preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { marketing: false },
    });

    expect(res.statusCode).toBe(200);
    expect(pushPrefsSchema.parse(res.json())).toEqual({
      transactional: true,
      marketing: false,
    });

    const consent = await prisma.consent.findFirst({
      where: { userId: user.id, purpose: 'push_marketing', withdrawnAt: null },
    });
    expect(consent).toBeNull();
  });

  it('user without consent is excluded from broadcast recipients', async () => {
    const { user } = await createUser({ verified: true });

    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[mkttest1]', platform: 'ios' },
    });

    const { resolveRecipients } = await import('../../src/services/broadcasts/targets.js');
    const recipients = await resolveRecipients({ kind: 'all' });

    expect(recipients.find((r) => r.userId === user.id)).toBeUndefined();
  });

  it('user with active consent is included in broadcast recipients', async () => {
    const { user } = await createUser({ verified: true });

    await prisma.deviceToken.create({
      data: { userId: user.id, expoPushToken: 'ExponentPushToken[mkttest2]', platform: 'ios' },
    });
    await recordConsent({
      userId: user.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: { test: true },
    });

    const { resolveRecipients } = await import('../../src/services/broadcasts/targets.js');
    const recipients = await resolveRecipients({ kind: 'all' });

    expect(recipients.find((r) => r.userId === user.id)).toBeDefined();
  });

  it('preserves transactional when older rows omit it', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    await prisma.user.update({
      where: { id: user.id },
      data: { pushPrefs: { marketing: false } },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/push-preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: { marketing: true },
    });

    expect(res.statusCode).toBe(200);
    expect(pushPrefsSchema.parse(res.json())).toEqual({
      transactional: true,
      marketing: true,
    });
  });

  it('rejects invalid payloads', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/push-preferences',
      headers: { authorization: bearer(env, user.id) },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
