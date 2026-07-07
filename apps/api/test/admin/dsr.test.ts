import { prisma } from '@jdm/db';
import { dsrDetailSchema, dsrListResponseSchema } from '@jdm/shared/dsr';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { bearer, createUser, makeApp, resetDatabase } from '../helpers.js';

describe('Admin DSR routes', () => {
  let app: FastifyInstance;
  let env: ReturnType<typeof loadEnv>;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
    env = loadEnv();
  });

  afterEach(async () => {
    await app.close();
  });

  const createDsr = async (adminId: string, userId: string, type: string = 'access') =>
    app.inject({
      method: 'POST',
      url: '/admin/dsr',
      headers: { authorization: bearer(env, adminId, 'admin') },
      payload: { userId, type },
    });

  describe('POST /admin/dsr', () => {
    it('creates a DSR with 15-day SLA', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const res = await createDsr(admin.id, user.id);
      expect(res.statusCode).toBe(200);

      const body = dsrDetailSchema.omit({ actions: true }).parse(res.json());
      expect(body.type).toBe('access');
      expect(body.status).toBe('pending_identity');
      expect(body.identityStatus).toBe('not_requested');
      expect(body.daysRemaining).toBeGreaterThanOrEqual(14);
      expect(body.daysRemaining).toBeLessThanOrEqual(15);
      expect(body.user.id).toBe(user.id);
    });

    it('records audit trail on create', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      await createDsr(admin.id, user.id);

      const audit = await prisma.adminAudit.findFirst({
        where: { action: 'dsr.create' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actorId).toBe(admin.id);
      expect(audit!.entityType).toBe('dsr');
    });

    it('rejects non-admin users', async () => {
      const { user: organizer } = await createUser({
        role: 'organizer',
        email: 'org@jdm.test',
      });
      const { user } = await createUser({ verified: true });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/dsr',
        headers: { authorization: bearer(env, organizer.id, 'organizer') },
        payload: { userId: user.id, type: 'access' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /admin/dsr', () => {
    it('lists DSRs with pagination', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      await createDsr(admin.id, user.id, 'access');
      await createDsr(admin.id, user.id, 'deletion');

      const res = await app.inject({
        method: 'GET',
        url: '/admin/dsr',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(200);
      const body = dsrListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(2);
      expect(body.items[0]!.daysRemaining).toBeDefined();
    });

    it('returns 400 for malformed cursor', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/dsr?cursor=not-valid-base64!@#',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toBe('invalid cursor');
    });

    it('returns 400 for cursor with missing fields', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });

      const badCursor = Buffer.from(JSON.stringify({ x: 1 })).toString('base64url');
      const res = await app.inject({
        method: 'GET',
        url: `/admin/dsr?cursor=${badCursor}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toBe('invalid cursor');
    });

    it('returns 400 for cursor with invalid date', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });

      const badCursor = Buffer.from(JSON.stringify({ c: 'not-a-date', i: 'abc' })).toString(
        'base64url',
      );
      const res = await app.inject({
        method: 'GET',
        url: `/admin/dsr?cursor=${badCursor}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toBe('invalid cursor');
    });

    it('filters by status', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      await createDsr(admin.id, user.id);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/dsr?status=open',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(200);
      const body = dsrListResponseSchema.parse(res.json());
      expect(body.items).toHaveLength(0);
    });
  });

  describe('GET /admin/dsr/:id', () => {
    it('returns DSR detail with action history', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      const res = await app.inject({
        method: 'GET',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(200);
      const body = dsrDetailSchema.parse(res.json());
      expect(body.id).toBe(dsrId);
      expect(body.actions).toHaveLength(1);
      expect(body.actions[0]!.action).toBe('created');
    });

    it('returns 404 for unknown DSR', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/dsr/nonexistent',
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /admin/dsr/:id', () => {
    it('verifies identity and transitions to open', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { identityStatus: 'verified' },
      });

      expect(res.statusCode).toBe(200);
      const body = dsrDetailSchema.parse(res.json());
      expect(body.identityStatus).toBe('verified');
      expect(body.status).toBe('open');
    });

    it('completes a DSR with resolver', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { identityStatus: 'verified' },
      });

      await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'in_progress' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'completed', note: 'Data exported and sent' },
      });

      expect(res.statusCode).toBe(200);
      const body = dsrDetailSchema.parse(res.json());
      expect(body.status).toBe('completed');
      expect(body.resolverId).toBe(admin.id);
      expect(body.resolvedAt).not.toBeNull();
    });

    it('denies a DSR with reason', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { identityStatus: 'verified' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'denied', denialReason: 'Identity verification failed' },
      });

      expect(res.statusCode).toBe(200);
      const body = dsrDetailSchema.parse(res.json());
      expect(body.status).toBe('denied');
      expect(body.denialReason).toBe('Identity verification failed');
    });

    it('rejects updates on resolved DSRs', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      await prisma.dataSubjectRequest.update({
        where: { id: dsrId },
        data: { status: 'completed', resolvedAt: new Date(), resolverId: admin.id },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'in_progress' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects completing before identity is verified', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'completed' },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json<{ message: string }>();
      expect(err.message).toContain('Identity must be verified');
    });

    it('rejects denying before identity is verified', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'denied', denialReason: 'Not applicable' },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json<{ message: string }>();
      expect(err.message).toContain('Identity must be verified');
    });

    it('rejects denied status without denialReason', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { identityStatus: 'verified' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'denied' },
      });

      expect(res.statusCode).toBe(422);
      const err = res.json<{ message: string }>();
      expect(err.message).toContain('denialReason is required');
    });

    it('no-op PATCH does not create DsrAction entries', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { note: 'just a note' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ message: string }>();
      expect(body.message).toBe('no changes');

      const actions = await prisma.dsrAction.findMany({ where: { dsrId } });
      expect(actions).toHaveLength(1); // only the initial 'created' action
    });

    it('records admin audit for non-state mutations', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { evidenceKey: 'dsr_evidence/proof.pdf' },
      });

      expect(res.statusCode).toBe(200);

      const audits = await prisma.adminAudit.findMany({
        where: { entityId: dsrId, action: 'dsr.update' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actorId).toBe(admin.id);
      expect((audits[0]!.metadata as Record<string, unknown>).evidenceKey).toBe(
        'dsr_evidence/proof.pdf',
      );
    });

    it('records action history for each update', async () => {
      const { user: admin } = await createUser({ role: 'admin', email: 'admin@jdm.test' });
      const { user } = await createUser({ verified: true });

      const createRes = await createDsr(admin.id, user.id);
      const dsrId = dsrDetailSchema.omit({ actions: true }).parse(createRes.json()).id;

      await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { identityStatus: 'verified' },
      });

      await app.inject({
        method: 'PATCH',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
        payload: { status: 'in_progress', note: 'Starting data export' },
      });

      const detailRes = await app.inject({
        method: 'GET',
        url: `/admin/dsr/${dsrId}`,
        headers: { authorization: bearer(env, admin.id, 'admin') },
      });

      const body = dsrDetailSchema.parse(detailRes.json());
      expect(body.actions).toHaveLength(3);
      expect(body.actions[0]!.action).toBe('created');
      expect(body.actions[1]!.action).toBe('verify_identity');
      expect(body.actions[2]!.action).toBe('start_processing');
    });
  });
});
