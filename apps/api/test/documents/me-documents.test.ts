import { prisma } from '@ccc/db';
import {
  documentUploadResponseSchema,
  MAX_DOCUMENT_BYTES,
  userDocumentListResponseSchema,
} from '@ccc/shared/documents';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('me documents', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
    await resetDatabase();
  });

  const auth = (userId: string) => ({ authorization: bearer(loadEnv(), userId) });

  it('requires authentication on all three routes', async () => {
    for (const [method, url] of [
      ['POST', '/me/documents/upload'],
      ['POST', '/me/documents'],
      ['GET', '/me/documents'],
    ] as const) {
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
  });

  it('presigns an upload scoped to the caller', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'image/jpeg', size: 2048 },
    });
    expect(res.statusCode).toBe(201);
    const body = documentUploadResponseSchema.parse(res.json());
    expect(body.objectKey).toMatch(new RegExp(`^identity-document/${user.id}/`));
    expect(body.headers['content-disposition']).toBe('attachment');
    expect(res.body).not.toContain('publicUrl');
  });

  it('rejects pdf and oversized uploads', async () => {
    const { user } = await createUser({ verified: true });
    const pdf = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'application/pdf', size: 2048 },
    });
    expect(pdf.statusCode).toBe(400);

    const big = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'image/jpeg', size: MAX_DOCUMENT_BYTES + 1 },
    });
    expect(big.statusCode).toBe(400);
  });

  it('creates a pending document from a presigned key', async () => {
    const { user } = await createUser({ verified: true });
    const presign = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(user.id),
      payload: { contentType: 'image/jpeg', size: 2048 },
    });
    const { objectKey } = documentUploadResponseSchema.parse(presign.json());

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'cnh', objectKey },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string; type: string };
    expect(body.status).toBe('pending');
    expect(body.type).toBe('cnh');

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.userId).toBe(user.id);
    expect(row.objectKey).toBe(objectKey);
  });

  it("rejects another user's object key", async () => {
    const { user } = await createUser({ verified: true, email: 'a@ccc.test' });
    const { user: other } = await createUser({ verified: true, email: 'b@ccc.test' });

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'cnh', objectKey: `identity-document/${other.id}/stolen.jpg` },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.userDocument.count()).toBe(0);
  });

  it('rejects a well-formed but non-existent object key', async () => {
    const { user } = await createUser({ verified: true });
    const spy = vi.spyOn(app.uploads, 'objectExists').mockResolvedValue(false);

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/me/documents',
        headers: auth(user.id),
        payload: { type: 'cnh', objectKey: `identity-document/${user.id}/never-uploaded.jpg` },
      });
      expect(res.statusCode).toBe(400);
      expect(await prisma.userDocument.count()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a key from another upload kind', async () => {
    const { user } = await createUser({ verified: true });
    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'cnh', objectKey: `avatar/${user.id}/a.jpg` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows only one live document at a time', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'rg', objectKey: `identity-document/${user.id}/b.jpg` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code?: string }).code).toBe('DOCUMENT_ALREADY_PENDING');
  });

  it('allows a resend after a rejection', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/a.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        reviewedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/me/documents',
      headers: auth(user.id),
      payload: { type: 'rg', objectKey: `identity-document/${user.id}/b.jpg` },
    });
    expect(res.statusCode).toBe(201);
  });

  it('lists documents newest first with a signed url', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'rg',
        objectKey: `identity-document/${user.id}/old.jpg`,
        status: 'rejected',
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

    const res = await app.inject({ method: 'GET', url: '/me/documents', headers: auth(user.id) });
    expect(res.statusCode).toBe(200);
    const body = userDocumentListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]!.type).toBe('cnh');
    expect(body.items[0]!.fileUrl).toContain('identity-document');
  });

  it('returns a null fileUrl for a purged document', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/gone.jpg`,
        status: 'approved',
        reviewedAt: new Date(),
        fileDeletedAt: new Date(),
      },
    });
    const res = await app.inject({ method: 'GET', url: '/me/documents', headers: auth(user.id) });
    const body = userDocumentListResponseSchema.parse(res.json());
    expect(body.items[0]!.fileUrl).toBeNull();
  });

  it("never lists another user's documents", async () => {
    const { user } = await createUser({ verified: true, email: 'a@ccc.test' });
    const { user: other } = await createUser({ verified: true, email: 'b@ccc.test' });
    await prisma.userDocument.create({
      data: { userId: other.id, type: 'cnh', objectKey: `identity-document/${other.id}/a.jpg` },
    });

    const res = await app.inject({ method: 'GET', url: '/me/documents', headers: auth(user.id) });
    expect(userDocumentListResponseSchema.parse(res.json()).items).toHaveLength(0);
  });

  it('rate limits per user, not per shared IP', async () => {
    const { user: userA } = await createUser({ verified: true, email: 'a@ccc.test' });
    const { user: userB } = await createUser({ verified: true, email: 'b@ccc.test' });

    // app.inject requests all share the same req.ip, so this only stays under
    // 5 per user if the bucket key is the sub, not the ip.
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/me/documents/upload',
        headers: auth(userA.id),
        payload: { contentType: 'image/jpeg', size: 2048 },
      });
      expect(res.statusCode).toBe(201);
    }

    const sixth = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(userA.id),
      payload: { contentType: 'image/jpeg', size: 2048 },
    });
    expect(sixth.statusCode).toBe(429);

    const forUserB = await app.inject({
      method: 'POST',
      url: '/me/documents/upload',
      headers: auth(userB.id),
      payload: { contentType: 'image/jpeg', size: 2048 },
    });
    expect(forUserB.statusCode).toBe(201);
  });
});
