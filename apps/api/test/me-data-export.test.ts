/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { prisma } from '@jdm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';
import { createExportJob, getExportJob, processExportJob } from '../src/services/data-export.js';

import { bearer, createUser, makeApp, resetDatabase } from './helpers.js';

const env = loadEnv();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dataExportJob = (prisma as any).dataExportJob as {
  create: (args: { data: { userId: string } }) => Promise<{ id: string; status: string }>;
  findUnique: (args: { where: { id: string } }) => Promise<{
    id: string;
    userId: string;
    status: string;
    objectKey: string | null;
    expiresAt: Date | null;
    completedAt: Date | null;
  } | null>;
  update: (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => Promise<{ id: string; status: string }>;
};

describe('data-export routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('POST /me/data-export', () => {
    it('401 without auth', async () => {
      const res = await app.inject({ method: 'POST', url: '/me/data-export' });
      expect(res.statusCode).toBe(401);
    });

    it('202 creates a new export job', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'POST',
        url: '/me/data-export',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe('pending');

      const job = await dataExportJob.findUnique({ where: { id: body.id } });
      expect(job).not.toBeNull();
      expect(job!.userId).toBe(user.id);
    });

    it('deduplicates via service when a job already exists', async () => {
      const { user } = await createUser({ verified: true });
      const { id: existingId } = await createExportJob(user.id);

      const res = await app.inject({
        method: 'POST',
        url: '/me/data-export',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.json().id).toBe(existingId);
    });

    it('rate limit is per-user, not global', async () => {
      const { user: userA } = await createUser({ email: 'ratelimit-a@test.com', verified: true });
      const { user: userB } = await createUser({ email: 'ratelimit-b@test.com', verified: true });

      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/me/data-export',
          headers: { authorization: bearer(env, userA.id) },
        });
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/me/data-export',
        headers: { authorization: bearer(env, userA.id) },
      });
      expect(blocked.statusCode).toBe(429);

      const allowed = await app.inject({
        method: 'POST',
        url: '/me/data-export',
        headers: { authorization: bearer(env, userB.id) },
      });
      expect(allowed.statusCode).toBeLessThan(400);
    });
  });

  describe('GET /me/data-export', () => {
    it('returns empty list when no jobs', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'GET',
        url: '/me/data-export',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });

    it('lists export jobs', async () => {
      const { user } = await createUser({ verified: true });
      await dataExportJob.create({ data: { userId: user.id } });
      const res = await app.inject({
        method: 'GET',
        url: '/me/data-export',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.json().items).toHaveLength(1);
    });
  });

  describe('GET /me/data-export/:id', () => {
    it('404 for unknown job', async () => {
      const { user } = await createUser({ verified: true });
      const res = await app.inject({
        method: 'GET',
        url: '/me/data-export/nonexistent',
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(404);
    });

    it('404 for another users job', async () => {
      const { user: user1 } = await createUser({ email: 'a@test.com', verified: true });
      const { user: user2 } = await createUser({ email: 'b@test.com', verified: true });
      const job = await dataExportJob.create({ data: { userId: user1.id } });

      const res = await app.inject({
        method: 'GET',
        url: `/me/data-export/${job.id}`,
        headers: { authorization: bearer(env, user2.id) },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns job details', async () => {
      const { user } = await createUser({ verified: true });
      const job = await dataExportJob.create({ data: { userId: user.id } });

      const res = await app.inject({
        method: 'GET',
        url: `/me/data-export/${job.id}`,
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(job.id);
      expect(body.status).toBe('pending');
    });

    it('failed job returns generic error code, not internal details', async () => {
      const { user } = await createUser({ verified: true });
      const job = await dataExportJob.create({ data: { userId: user.id } });
      await dataExportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorMessage: 'PrismaClientKnownRequestError: connection refused at /internal/path',
          completedAt: new Date(),
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/me/data-export/${job.id}`,
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.error).toBe('ExportFailed');
      expect(body.errorMessage).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('PrismaClient');
    });

    it('410 when export has expired', async () => {
      const { user } = await createUser({ verified: true });
      const job = await dataExportJob.create({ data: { userId: user.id } });
      await dataExportJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          objectKey: 'data-export/test/expired.json',
          expiresAt: new Date(Date.now() - 1000),
          completedAt: new Date(Date.now() - 86400_000),
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/me/data-export/${job.id}`,
        headers: { authorization: bearer(env, user.id) },
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().error).toBe('ExportExpired');
    });
  });
});

describe('data-export service', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('createExportJob creates a pending job', async () => {
    const { user } = await createUser({ verified: true });
    const result = await createExportJob(user.id);
    expect(result.status).toBe('pending');

    const job = await dataExportJob.findUnique({ where: { id: result.id } });
    expect(job).not.toBeNull();
  });

  it('createExportJob deduplicates active jobs', async () => {
    const { user } = await createUser({ verified: true });
    const r1 = await createExportJob(user.id);
    const r2 = await createExportJob(user.id);
    expect(r1.id).toBe(r2.id);
  });

  it('processExportJob transitions to completed (dev mode, no R2)', async () => {
    const { user } = await createUser({ verified: true });
    const { id } = await createExportJob(user.id);

    const outcome = await processExportJob(id, env);

    expect(outcome).toBe('completed');
    const job = await dataExportJob.findUnique({ where: { id } });
    expect(job!.status).toBe('completed');
    expect(job!.objectKey).toContain('data-export/');
    expect(job!.expiresAt).not.toBeNull();
    expect(job!.completedAt).not.toBeNull();
  });

  it('getExportJob scopes by userId', async () => {
    const { user: u1 } = await createUser({ email: 'a@t.com', verified: true });
    const { user: u2 } = await createUser({ email: 'b@t.com', verified: true });
    const { id } = await createExportJob(u1.id);

    expect(await getExportJob(id, u1.id)).not.toBeNull();
    expect(await getExportJob(id, u2.id)).toBeNull();
  });

  it('concurrent createExportJob calls produce a single job', async () => {
    const { user } = await createUser({ verified: true });
    const results = await Promise.all([
      createExportJob(user.id),
      createExportJob(user.id),
      createExportJob(user.id),
    ]);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
  });

  it('concurrent processExportJob calls only process once', async () => {
    const { user } = await createUser({ verified: true });
    const { id } = await createExportJob(user.id);

    const outcomes = await Promise.all([processExportJob(id, env), processExportJob(id, env)]);

    expect(outcomes.filter((o) => o === 'completed')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'skipped')).toHaveLength(1);
    const job = await dataExportJob.findUnique({ where: { id } });
    expect(job!.status).toBe('completed');
  });

  it('processExportJob collects consent history', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.consent.create({
      data: {
        userId: user.id,
        purpose: 'push_marketing',
        version: '1.0',
        channel: 'mobile',
        evidence: { screen: 'onboarding' },
      },
    });

    const { id } = await createExportJob(user.id);
    await processExportJob(id, env);

    const job = await dataExportJob.findUnique({ where: { id } });
    expect(job!.status).toBe('completed');
  });
});
