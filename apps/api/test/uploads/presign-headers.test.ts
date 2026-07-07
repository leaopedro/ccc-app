import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('presign response headers binding', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const presign = async (
    app: FastifyInstance,
    userId: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const env = loadEnv();
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { authorization: bearer(env, userId) },
      payload: { kind: 'avatar', contentType: 'image/jpeg', size: 2048, ...overrides },
    });
    return res;
  };

  it('returns content-disposition: inline header', async () => {
    const { user } = await createUser({ verified: true });
    const res = await presign(app, user.id);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ headers: Record<string, string> }>();
    expect(body.headers['content-disposition']).toBe('inline');
  });

  it('returns cache-control header', async () => {
    const { user } = await createUser({ verified: true });
    const res = await presign(app, user.id);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ headers: Record<string, string> }>();
    expect(body.headers['cache-control']).toMatch(/^public,/);
  });

  it('returns content-type header matching request', async () => {
    const { user } = await createUser({ verified: true });
    const res = await presign(app, user.id);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ headers: Record<string, string> }>();
    expect(body.headers['content-type']).toBe('image/jpeg');
  });

  it('returns content-length header matching request size', async () => {
    const { user } = await createUser({ verified: true });
    const res = await presign(app, user.id);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ headers: Record<string, string> }>();
    expect(body.headers['content-length']).toBe('2048');
  });

  it('includes x-amz-meta-kind in headers and omits uid', async () => {
    const { user } = await createUser({ verified: true });
    const res = await presign(app, user.id);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ headers: Record<string, string> }>();
    expect(body.headers['x-amz-meta-kind']).toBe('avatar');
    expect(body.headers['x-amz-meta-uid']).toBeUndefined();
  });

  it('webp content type also gets all bound headers', async () => {
    const { user } = await createUser({ verified: true });
    const res = await presign(app, user.id, { contentType: 'image/webp' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ headers: Record<string, string> }>();
    expect(body.headers['content-type']).toBe('image/webp');
    expect(body.headers['content-disposition']).toBe('inline');
    expect(body.headers['x-amz-meta-kind']).toBe('avatar');
  });
});
