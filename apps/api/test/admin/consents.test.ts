import { adminConsentListResponseSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { recordConsent } from '../../src/services/consent.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /admin/consents', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists consent records for admins', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    await recordConsent({
      userId: user.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      evidence: { checkbox: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminConsentListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.purpose).toBe('push_marketing');
    expect(body.items[0]!.userName).toBe('Test User');
    expect(body.items[0]!.userEmail).toBe('user@jdm.test');
  });

  it('filters by userId', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user: u1 } = await createUser({ verified: true, email: 'u1@jdm.test', name: 'U1' });
    const { user: u2 } = await createUser({ verified: true, email: 'u2@jdm.test', name: 'U2' });
    const env = loadEnv();

    await recordConsent({
      userId: u1.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });
    await recordConsent({
      userId: u2.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/consents?userId=${u1.id}`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    const body = adminConsentListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.userEmail).toBe('u1@jdm.test');
  });

  it('filters by purpose', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    await recordConsent({
      userId: user.id,
      purpose: 'push_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });
    await recordConsent({
      userId: user.id,
      purpose: 'email_marketing',
      version: 'v1',
      channel: 'mobile',
      ipAddress: null,
      userAgent: null,
      evidence: {},
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents?purpose=push_marketing',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(res.statusCode).toBe(200);
    expect(adminConsentListResponseSchema.parse(res.json()).items).toHaveLength(1);
  });

  it('rejects non-admin users', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents',
      headers: { authorization: bearer(env, user.id) },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects organizer users (LGPD audit data is admin-only)', async () => {
    const { user: organizer } = await createUser({
      role: 'organizer',
      verified: true,
      email: 'organizer@jdm.test',
    });
    const env = loadEnv();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/consents',
      headers: { authorization: bearer(env, organizer.id, 'organizer') },
    });

    expect(res.statusCode).toBe(403);
  });

  it('paginates with cursor', async () => {
    const { user: admin } = await createUser({
      role: 'admin',
      verified: true,
      email: 'admin@jdm.test',
    });
    const { user } = await createUser({ verified: true });
    const env = loadEnv();

    for (const p of ['push_marketing', 'email_marketing', 'newsletter'] as const) {
      await recordConsent({
        userId: user.id,
        purpose: p,
        version: 'v1',
        channel: 'mobile',
        ipAddress: null,
        userAgent: null,
        evidence: {},
      });
    }

    const r1 = await app.inject({
      method: 'GET',
      url: '/admin/consents?limit=2',
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    expect(r1.statusCode).toBe(200);
    const page1 = adminConsentListResponseSchema.parse(r1.json());
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const r2 = await app.inject({
      method: 'GET',
      url: `/admin/consents?limit=2&cursor=${page1.nextCursor}`,
      headers: { authorization: bearer(env, admin.id, 'admin') },
    });

    const page2 = adminConsentListResponseSchema.parse(r2.json());
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
