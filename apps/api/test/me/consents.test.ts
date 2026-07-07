import { prisma } from '@jdm/db';
import { consentListResponseSchema, consentRecordSchema } from '@jdm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('/me/consents', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /me/consents', () => {
    it('grants consent and returns the record', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          purpose: 'push_marketing',
          version: 'v1-2026-05-14',
          evidence: { source: 'consent_screen', checkbox: true, text: 'Aceito marketing push' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = consentRecordSchema.parse(res.json());
      expect(body.purpose).toBe('push_marketing');
      expect(body.withdrawnAt).toBeNull();
    });

    it('is idempotent — same (purpose, version) returns same record', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      const payload = {
        purpose: 'push_marketing',
        version: 'v1',
        evidence: { source: 'consent_screen', checkbox: true },
      };

      const r1 = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload,
      });
      const r2 = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload,
      });

      const id1 = consentRecordSchema.parse(r1.json()).id;
      const id2 = consentRecordSchema.parse(r2.json()).id;
      expect(id1).toBe(id2);
      const count = await prisma.consent.count({ where: { userId: user.id } });
      expect(count).toBe(1);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        payload: {
          purpose: 'push_marketing',
          version: 'v1',
          evidence: { source: 'consent_screen', checkbox: true },
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it.each([
      ['admin', 'web_admin'],
      ['staff', 'web_admin'],
      ['organizer', 'web_admin'],
    ] as const)('role %s produces channel=%s', async (role, expectedChannel) => {
      const { user } = await createUser({ verified: true, role });
      const env = loadEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id, role) },
        payload: {
          purpose: 'cookies_analytics',
          version: 'v1-2026-05-14',
          evidence: { source: 'cookie_banner', accepted: true },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = consentRecordSchema.parse(res.json());
      expect(body.channel).toBe(expectedChannel);
    });

    it('user role produces channel=mobile', async () => {
      const { user } = await createUser({ verified: true, role: 'user' });
      const env = loadEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id, 'user') },
        payload: {
          purpose: 'push_marketing',
          version: 'v1-2026-05-14',
          evidence: { source: 'consent_screen', checkbox: true },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = consentRecordSchema.parse(res.json());
      expect(body.channel).toBe('mobile');
    });

    it('admin consent persists cookies_analytics row with web_admin channel', async () => {
      const { user: admin } = await createUser({ verified: true, role: 'admin' });
      const env = loadEnv();
      const version = 'v1-2026-05-14';

      const res = await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: {
          purpose: 'cookies_analytics',
          version,
          evidence: { source: 'cookie_banner', accepted: true },
        },
      });

      expect(res.statusCode).toBe(200);

      const row = await prisma.consent.findFirst({
        where: { userId: admin.id, purpose: 'cookies_analytics', version },
      });
      expect(row).not.toBeNull();
      expect(row!.purpose).toBe('cookies_analytics');
      expect(row!.channel).toBe('web_admin');
      expect(row!.version).toBe(version);
      expect(row!.withdrawnAt).toBeNull();
    });
  });

  describe('DELETE /me/consents/:purpose', () => {
    it('withdraws an active consent', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          purpose: 'push_marketing',
          version: 'v1',
          evidence: { source: 'consent_screen', checkbox: true },
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/me/consents/push_marketing',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ withdrawn: true });
    });

    it('returns withdrawn: false when no active consent exists', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'DELETE',
        url: '/me/consents/push_marketing',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ withdrawn: false });
    });

    it('rejects invalid purpose', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'DELETE',
        url: '/me/consents/invalid_purpose',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /me/consents', () => {
    it('lists all consents for the authenticated user', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      await app.inject({
        method: 'POST',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
        payload: {
          purpose: 'push_marketing',
          version: 'v1',
          evidence: { source: 'consent_screen', checkbox: true },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      const body = consentListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.purpose).toBe('push_marketing');
    });

    it('returns empty list when no consents exist', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();

      const res = await app.inject({
        method: 'GET',
        url: '/me/consents',
        headers: { authorization: bearer(env, user.id) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [] });
    });
  });
});
