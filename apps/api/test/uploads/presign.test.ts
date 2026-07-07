import { presignResponseSchema } from '@jdm/shared/uploads';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('POST /uploads/presign', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 1234 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns a signed URL for a valid avatar request', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 2048 },
    });
    expect(res.statusCode).toBe(200);
    const body = presignResponseSchema.parse(res.json());
    expect(body.objectKey).toMatch(new RegExp(`^avatar/${user.id}/`));
    expect(body.publicUrl).toContain(body.objectKey);
    expect(body.uploadUrl).toMatch(/^https?:\/\//);
    expect(body.headers['content-type']).toBe('image/jpeg');
  });

  it('rejects non-image content types', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'avatar', contentType: 'application/pdf', size: 2048 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects oversized uploads', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 11 * 1024 * 1024 },
    });
    expect(res.statusCode).toBe(400);
  });

  // Regression: `garage_cover` is a premium-gated kind reachable only via
  // POST /me/garage/cover/upload. It must NOT appear in the shared
  // UPLOAD_KINDS enum, otherwise any authenticated user could call the
  // generic presign route and mint a valid R2 upload URL, bypassing the
  // premium gate.
  it('rejects garage_cover kind on the generic presign route (premium gate bypass)', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, user.id) },
      payload: { kind: 'garage_cover', contentType: 'image/jpeg', size: 2048 },
    });
    expect(res.statusCode).toBe(400);
  });
});
