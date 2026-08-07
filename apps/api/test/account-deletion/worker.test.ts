import { prisma } from '@ccc/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { runVendorFanout } from '../../src/services/account-deletion/vendor-fanout.js';
import { runDeletionWorkerTick } from '../../src/workers/account-deletion.js';
import { createUser, makeApp, makeAppWithFakeStripe, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('anonymizeUser', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('strips PII and flips status to anonymized', async () => {
    const { user } = await createUser({
      email: 'victim@jdm.test',
      name: 'Victim User',
      verified: true,
    });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt, bio: 'my bio', city: 'SP', stateCode: 'SP' },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    const result = await anonymizeUser(user.id, app.uploads);

    expect(result.ok).toBe(true);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe('anonymized');
    expect(row?.anonymizedAt).not.toBeNull();
    expect(row?.name).toBe('Deleted User');
    expect(row?.email).toMatch(/^deleted_[0-9a-f]+@removed\.local$/);
    expect(row?.bio).toBeNull();
    expect(row?.city).toBeNull();
    expect(row?.stateCode).toBeNull();
    expect(row?.avatarObjectKey).toBeNull();
    expect(row?.passwordHash).toBeNull();

    const log = await prisma.deletionLog.findUnique({ where: { userId: user.id } });
    expect(log?.completedAt).not.toBeNull();
    const steps = log?.steps as Array<{ step: string; status: string }>;
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
  });

  it('queues R2 object deletion for avatar and car photos', async () => {
    const { user } = await createUser({ email: 'r2@jdm.test', verified: true });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'deleted',
        deletedAt,
        avatarObjectKey: `avatar/${user.id}/test.jpg`,
      },
    });
    const car = await prisma.car.create({
      data: { userId: user.id, make: 'Honda', model: 'Civic', year: 1999, nickname: 'Civic' },
    });
    await prisma.carPhoto.create({
      data: { carId: car.id, objectKey: `car_photo/${user.id}/photo.jpg` },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.avatarObjectKey).toBeNull();

    const photos = await prisma.carPhoto.findMany({ where: { car: { userId: user.id } } });
    expect(photos.length).toBe(0);

    const queued = await prisma.uploadDeletionQueue.findMany({
      where: { reason: 'account_anonymized' },
      orderBy: { objectKey: 'asc' },
    });
    expect(queued.map((q) => q.objectKey)).toEqual([
      `avatar/${user.id}/test.jpg`,
      `car_photo/${user.id}/photo.jpg`,
    ]);
  });

  it('preserves user row for fiscal retention (orders)', async () => {
    const { user } = await createUser({ email: 'fiscal@jdm.test', verified: true });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe('anonymized');
  });

  it('is idempotent for already-anonymized user', async () => {
    const { user } = await createUser({ email: 'idem@jdm.test', verified: true });
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'anonymized', deletedAt: now, anonymizedAt: now },
    });
    await prisma.deletionLog.create({
      data: { userId: user.id, requestedAt: now, completedAt: now, steps: [] },
    });

    const result = await anonymizeUser(user.id, app.uploads);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skipped).toBe(true);
  });
});

describe('runVendorFanout', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    // Fake Stripe: real client makes a live deleteCustomersByEmail call that
    // errors offline in CI, flipping the step to 'error'.
    app = (await makeAppWithFakeStripe()).app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns step entries for each vendor', async () => {
    const { user } = await createUser({ email: 'vendor@jdm.test', verified: true });
    const steps = await runVendorFanout(user.id, app.stripe, env);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.status === 'ok' || s.status === 'skipped')).toBe(true);
  });
});

describe('runDeletionWorkerTick', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDatabase();
    // Fake Stripe so the deletion worker's vendor fanout stays offline in CI.
    app = (await makeAppWithFakeStripe()).app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('anonymizes users past grace period', async () => {
    const { user } = await createUser({ email: 'expired@jdm.test', verified: true });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    await runDeletionWorkerTick({
      graceDays: 30,
      uploads: app.uploads,
      stripe: app.stripe,
      env,
      batchSize: 10,
    });

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe('anonymized');

    const log = await prisma.deletionLog.findUnique({ where: { userId: user.id } });
    expect(log?.completedAt).not.toBeNull();
  });

  it('skips users still within grace period', async () => {
    const { user } = await createUser({ email: 'recent@jdm.test', verified: true });
    const deletedAt = new Date(Date.now() - 5 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    await runDeletionWorkerTick({
      graceDays: 30,
      uploads: app.uploads,
      stripe: app.stripe,
      env,
      batchSize: 10,
    });

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe('deleted');
  });

  it('persists vendor fanout steps in DeletionLog', async () => {
    const { user } = await createUser({ email: 'fanout@jdm.test', verified: true });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt },
    });
    await prisma.deletionLog.create({ data: { userId: user.id, requestedAt: deletedAt } });

    await runDeletionWorkerTick({
      graceDays: 30,
      uploads: app.uploads,
      stripe: app.stripe,
      env,
      batchSize: 10,
    });

    const log = await prisma.deletionLog.findUnique({ where: { userId: user.id } });
    const steps = log?.steps as Array<{ step: string; status: string }>;
    const fanoutSteps = steps.filter(
      (s) =>
        s.step.startsWith('stripe_') ||
        s.step.startsWith('expo_') ||
        s.step.startsWith('sentry_') ||
        s.step.startsWith('resend_'),
    );
    expect(fanoutSteps.length).toBeGreaterThan(0);
  });

  it('handles missing DeletionLog row gracefully on error', async () => {
    const { user } = await createUser({ email: 'nolog@jdm.test', verified: true });
    const deletedAt = new Date(Date.now() - 31 * 24 * 3600_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deleted', deletedAt },
    });
    // Intentionally do NOT create a DeletionLog row

    // Should not throw even if DeletionLog is missing
    await expect(
      runDeletionWorkerTick({
        graceDays: 30,
        uploads: app.uploads,
        stripe: app.stripe,
        env,
        batchSize: 10,
      }),
    ).resolves.not.toThrow();
  });
});
