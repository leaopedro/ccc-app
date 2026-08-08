import { prisma } from '@ccc/db';
import { publicProfileSchema } from '@ccc/shared/profile';
import { CPF_IMMUTABLE_CODE, cpfImmutableErrorSchema } from '@ccc/shared/profile-status';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
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

  describe('cpf immutability', () => {
    it('accepts and encrypts cpf when the column is null', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '529.982.247-25' },
      });
      expect(res.statusCode).toBe(200);
      const body = publicProfileSchema.parse(res.json());
      expect(body.cpf).toBe('52998224725');

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.cpf).not.toBeNull();
      expect(row.cpf).toMatch(/^enc_v1:/);
    });

    it('rejects changing to a different cpf once one is stored', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '529.982.247-25' },
      });
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '111.444.777-35' },
      });

      expect(res.statusCode).toBe(409);
      const body = cpfImmutableErrorSchema.parse(res.json());
      expect(body).toMatchObject({ error: 'Conflict', code: CPF_IMMUTABLE_CODE });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.cpf).toBe(stored.cpf);
    });

    it('returns 409 without updating when the stored cpf cannot be decrypted', async () => {
      // Corrupts a genuinely-encrypted value's auth tag by flipping one hex
      // digit: same segment lengths as encryptField's real output (so
      // isEncrypted() still reads it as encrypted), but GCM tag
      // verification fails on decrypt, so decryptField's try/catch returns
      // null. Writing this directly to the DB (bypassing the API) avoids
      // mocking any shared module, which would race with other test files
      // sharing this suite's single-fork process.
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      const encrypted = encryptField('52998224725', env.FIELD_ENCRYPTION_KEY);
      const parts = encrypted.split(':');
      const tag = parts[3]!;
      const corruptedTag = (tag[0] === '0' ? '1' : '0') + tag.slice(1);
      const corrupted = `${parts[0]}:${parts[1]}:${parts[2]}:${corruptedTag}`;
      await prisma.user.update({ where: { id: user.id }, data: { cpf: corrupted } });

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '111.444.777-35' },
      });

      expect(res.statusCode).toBe(409);
      const body = cpfImmutableErrorSchema.parse(res.json());
      expect(body).toMatchObject({ error: 'Conflict', code: CPF_IMMUTABLE_CODE });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.cpf).toBe(corrupted);
    });

    it('accepts resubmitting the same cpf, masked, as a no-op', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '52998224725' },
      });
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '529.982.247-25' },
      });

      expect(res.statusCode).toBe(200);
      const body = publicProfileSchema.parse(res.json());
      expect(body.cpf).toBe('52998224725');

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.cpf).toBe(stored.cpf);
    });

    it('keeps phone freely editable once a cpf is stored', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '529.982.247-25', phone: '(11) 98765-4321' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { phone: '(21) 91234-5678' },
      });

      expect(res.statusCode).toBe(200);
      const body = publicProfileSchema.parse(res.json());
      expect(body.phone).toBe('21912345678');
      expect(body.cpf).toBe('52998224725');
    });

    it('rejects an invalid cpf with a 400, checked before the immutability rule', async () => {
      const { user } = await createUser({ verified: true });
      const env = loadEnv();
      await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '529.982.247-25' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { authorization: bearer(env, user.id) },
        payload: { cpf: '111.111.111-11' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
