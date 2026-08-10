import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('POST /uploads/presign — box kinds role gate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const boxKinds = ['box_item', 'partner_logo', 'partner_module'] as const;

  for (const kind of boxKinds) {
    describe(`kind: ${kind}`, () => {
      it('403 for staff', async () => {
        const { user } = await createUser({
          email: `staff-${kind}-${Date.now()}@jdm-test.local`,
          verified: true,
          role: 'staff',
        });
        const res = await app.inject({
          method: 'POST',
          url: '/uploads/presign',
          headers: { authorization: bearer(env, user.id, 'staff') },
          payload: { kind, contentType: 'image/jpeg', size: 50_000 },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json<{ error: string }>().error).toBe('Forbidden');
      });

      it('403 for plain user', async () => {
        const { user } = await createUser({
          email: `user-${kind}-${Date.now()}@jdm-test.local`,
          verified: true,
          role: 'user',
        });
        const res = await app.inject({
          method: 'POST',
          url: '/uploads/presign',
          headers: { authorization: bearer(env, user.id, 'user') },
          payload: { kind, contentType: 'image/jpeg', size: 50_000 },
        });
        expect(res.statusCode).toBe(403);
      });

      it('200 for organizer', async () => {
        const { user } = await createUser({
          email: `org-${kind}-${Date.now()}@jdm-test.local`,
          verified: true,
          role: 'organizer',
        });
        const res = await app.inject({
          method: 'POST',
          url: '/uploads/presign',
          headers: { authorization: bearer(env, user.id, 'organizer') },
          payload: { kind, contentType: 'image/jpeg', size: 50_000 },
        });
        expect(res.statusCode).toBe(200);
        const json = res.json<{ objectKey: string }>();
        expect(json.objectKey.startsWith(`${kind}/${user.id}/`)).toBe(true);
      });

      it('200 for admin', async () => {
        const { user } = await createUser({
          email: `admin-${kind}-${Date.now()}@jdm-test.local`,
          verified: true,
          role: 'admin',
        });
        const res = await app.inject({
          method: 'POST',
          url: '/uploads/presign',
          headers: { authorization: bearer(env, user.id, 'admin') },
          payload: { kind, contentType: 'image/jpeg', size: 50_000 },
        });
        expect(res.statusCode).toBe(200);
      });
    });
  }
});
