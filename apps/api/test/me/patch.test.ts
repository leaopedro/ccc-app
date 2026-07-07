import { publicProfileSchema } from '@jdm/shared/profile';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import * as deletionQueue from '../../src/services/uploads/deletion-queue.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('PATCH /me', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/me', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('updates allowed fields', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { name: 'Novo', bio: 'biker', city: 'SP', stateCode: 'SP' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: user.id,
      name: 'Novo',
      bio: 'biker',
      city: 'SP',
      stateCode: 'SP',
      avatarUrl: null,
    });
  });

  it('rejects invalid state code', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { stateCode: 'XX' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ignores unknown keys', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { role: 'admin', name: 'ok' },
    });
    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.role).toBe('user');
  });

  it('derives avatarUrl from avatarObjectKey via uploads.buildPublicUrl', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const objectKey = `avatar/${user.id}/abc.jpg`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { avatarObjectKey: objectKey },
    });
    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.avatarUrl).toBeTypeOf('string');
    expect(body.avatarUrl).toContain(objectKey);
  });

  it('rejects avatarObjectKey not owned by the user', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { avatarObjectKey: 'avatar/other-user-id/stolen.jpg' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BadRequest' });
  });

  it('accepts avatarObjectKey owned by the user', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { avatarObjectKey: `avatar/${user.id}/my-photo.jpg` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts null avatarObjectKey to clear avatar', async () => {
    const { user } = await createUser({ verified: true });
    const env = loadEnv();
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(env, user.id) },
      payload: { avatarObjectKey: null },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 when queueing old avatar deletion fails after profile update', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { avatarObjectKey: `avatar/${user.id}/old.jpg` },
    });

    vi.spyOn(deletionQueue, 'queueObjectDeletion').mockRejectedValueOnce(new Error('queue down'));

    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { avatarObjectKey: `avatar/${user.id}/new.jpg` },
    });

    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.avatarUrl).toContain(`avatar/${user.id}/new.jpg`);
  });
});
