import { prisma } from '@ccc/db';
import { profileStatusSchema } from '@ccc/shared/profile-status';
import { publicProfileSchema } from '@ccc/shared/profile';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { isEncrypted } from '../../src/services/crypto/field-encryption.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('profile cpf/phone and GET /me/profile-status', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  it('requires authentication on profile-status', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/profile-status' });
    expect(res.statusCode).toBe(401);
  });

  it('returns nulls for a fresh profile', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.cpf).toBeNull();
    expect(body.phone).toBeNull();
  });

  it('stores the cpf encrypted and returns it in the clear to its owner', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25', phone: '(11) 98765-4321' },
    });
    expect(res.statusCode).toBe(200);
    const body = publicProfileSchema.parse(res.json());
    expect(body.cpf).toBe('52998224725');
    expect(body.phone).toBe('11987654321');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isEncrypted(row.cpf!)).toBe(true);
    expect(row.cpf).not.toContain('52998224725');
    expect(row.phone).toBe('11987654321');
  });

  it('rejects an invalid cpf with 400 and leaves the row untouched', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '111.111.111-11' },
    });
    expect(res.statusCode).toBe(400);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.cpf).toBeNull();
  });

  it('reports both scopes incomplete for a fresh user', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = profileStatusSchema.parse(res.json());
    expect(body.fields).toEqual({ cpf: false, phone: false, document: false });
    expect(body.checkout).toEqual({ complete: false, missing: ['cpf', 'phone'] });
    expect(body.subscription).toEqual({
      complete: false,
      missing: ['cpf', 'phone', 'document'],
    });
    expect(body.latestDocument).toBeNull();
  });

  it('completes the checkout scope once cpf and phone land', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25', phone: '11987654321' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    const body = profileStatusSchema.parse(res.json());
    expect(body.checkout).toEqual({ complete: true, missing: [] });
    expect(body.subscription).toEqual({ complete: false, missing: ['document'] });
  });

  it('surfaces the latest document and completes the subscription scope', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25', phone: '11987654321' },
    });
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    const body = profileStatusSchema.parse(res.json());
    expect(body.subscription).toEqual({ complete: true, missing: [] });
    expect(body.latestDocument?.status).toBe('pending');
    expect(body.latestDocument?.type).toBe('cnh');
  });

  it('reports the newest document when several exist', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'rg',
        objectKey: `identity-document/${user.id}/old.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        sentAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/new.jpg`,
        sentAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/profile-status',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    const body = profileStatusSchema.parse(res.json());
    expect(body.latestDocument?.type).toBe('cnh');
    expect(body.latestDocument?.status).toBe('pending');
  });

  it('never leaks the cpf ciphertext in the response', async () => {
    const { user } = await createUser({ verified: true });
    await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
      payload: { cpf: '529.982.247-25' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: bearer(loadEnv(), user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('52998224725');
    expect(res.body).not.toContain('enc_v1:');
  });
});
