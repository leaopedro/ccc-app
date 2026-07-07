import { prisma } from '@jdm/db';
import { adminAuditListResponseSchema } from '@jdm/shared/admin';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('GET /admin/audit', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/audit' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user', async () => {
    const { user } = await createUser({ email: 'u@jdm.test', role: 'user', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: bearer(loadEnv(), user.id, 'user') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for organizer', async () => {
    const { user } = await createUser({ email: 'o@jdm.test', role: 'organizer', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: bearer(loadEnv(), user.id, 'organizer') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for staff', async () => {
    const { user } = await createUser({ email: 's@jdm.test', role: 'staff', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: bearer(loadEnv(), user.id, 'staff') },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with empty list for admin when no records', async () => {
    const { user } = await createUser({ email: 'a@jdm.test', role: 'admin', verified: true });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminAuditListResponseSchema.parse(res.json());
    expect(body).toMatchObject({ items: [], nextCursor: null });
  });

  it('returns audit rows with correct shape', async () => {
    const { user } = await createUser({ email: 'a2@jdm.test', role: 'admin', verified: true });
    await prisma.adminAudit.create({
      data: {
        actorId: user.id,
        action: 'event.create',
        entityType: 'event',
        entityId: 'evt_1',
        metadata: { slug: 'test' },
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminAuditListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      actorId: user.id,
      action: 'event.create',
      entityType: 'event',
      entityId: 'evt_1',
      metadata: { slug: 'test' },
    });
    expect(typeof body.items[0]!.createdAt).toBe('string');
  });

  it('filters by actorId', async () => {
    const { user: a } = await createUser({ email: 'a3@jdm.test', role: 'admin', verified: true });
    const { user: b } = await createUser({ email: 'b3@jdm.test', role: 'user', verified: true });
    await prisma.adminAudit.createMany({
      data: [
        { actorId: a.id, action: 'event.create', entityType: 'event', entityId: 'e1' },
        { actorId: b.id, action: 'tier.create', entityType: 'tier', entityId: 't1' },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/admin/audit?actorId=${a.id}`,
      headers: { authorization: bearer(loadEnv(), a.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminAuditListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.actorId).toBe(a.id);
  });

  it('filters by action', async () => {
    const { user } = await createUser({ email: 'a4@jdm.test', role: 'admin', verified: true });
    await prisma.adminAudit.createMany({
      data: [
        { actorId: user.id, action: 'event.create', entityType: 'event', entityId: 'e1' },
        { actorId: user.id, action: 'tier.create', entityType: 'tier', entityId: 't1' },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit?action=event.create',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminAuditListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.action).toBe('event.create');
  });

  it('paginates with cursor', async () => {
    const { user } = await createUser({ email: 'a5@jdm.test', role: 'admin', verified: true });
    for (let i = 0; i < 3; i++) {
      await prisma.adminAudit.create({
        data: { actorId: user.id, action: 'event.create', entityType: 'event', entityId: `e${i}` },
      });
    }
    const page1 = await app.inject({
      method: 'GET',
      url: '/admin/audit?limit=2',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    const body1 = adminAuditListResponseSchema.parse(page1.json());
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: 'GET',
      url: `/admin/audit?limit=2&cursor=${body1.nextCursor ?? ''}`,
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    const body2 = adminAuditListResponseSchema.parse(page2.json());
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });

  it('filters by entityType', async () => {
    const { user } = await createUser({ email: 'a6@jdm.test', role: 'admin', verified: true });
    await prisma.adminAudit.createMany({
      data: [
        { actorId: user.id, action: 'event.create', entityType: 'event', entityId: 'e1' },
        { actorId: user.id, action: 'tier.create', entityType: 'tier', entityId: 't1' },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit?entityType=event',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminAuditListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.entityType).toBe('event');
  });

  it('filters by dateFrom and dateTo', async () => {
    const { user } = await createUser({ email: 'a7@jdm.test', role: 'admin', verified: true });
    const past = new Date('2020-01-01T00:00:00Z');
    const recent = new Date('2025-01-01T00:00:00Z');
    await prisma.adminAudit.createMany({
      data: [
        {
          actorId: user.id,
          action: 'event.create',
          entityType: 'event',
          entityId: 'old',
          createdAt: past,
        },
        {
          actorId: user.id,
          action: 'tier.create',
          entityType: 'tier',
          entityId: 'new',
          createdAt: recent,
        },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit?dateFrom=2024-01-01T00:00:00Z&dateTo=2026-01-01T00:00:00Z',
      headers: { authorization: bearer(loadEnv(), user.id, 'admin') },
    });
    expect(res.statusCode).toBe(200);
    const body = adminAuditListResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.entityId).toBe('new');
  });
});
