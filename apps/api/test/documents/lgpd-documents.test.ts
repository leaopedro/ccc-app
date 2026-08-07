import { prisma } from '@ccc/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { anonymizeUser } from '../../src/services/account-deletion/anonymize.js';
import { encryptField } from '../../src/services/crypto/field-encryption.js';
// The collector is exported under a _forTest alias (data-export.ts:468); the
// public surface is processExportJob, which needs a job row and R2.
import { _collectUserDataForTest as collectUserData } from '../../src/services/data-export.js';
import { DevUploads } from '../../src/services/uploads/dev.js';
import {
  DOCUMENT_APPROVED_RETENTION_DAYS,
  DOCUMENT_REJECTED_RETENTION_DAYS,
  purgeExpiredDocumentFiles,
} from '../../src/workers/retention.js';
import { createUser, resetDatabase } from '../helpers.js';

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 3600 * 1000);

describe('LGPD handling for cpf, phone and documents', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it('includes cpf, phone and document metadata in the data export', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        cpf: encryptField('52998224725', loadEnv().FIELD_ENCRYPTION_KEY),
        phone: '11987654321',
      },
    });
    await prisma.userDocument.create({
      data: { userId: user.id, type: 'cnh', objectKey: `identity-document/${user.id}/a.jpg` },
    });

    const payload = await collectUserData(user.id);
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('52998224725');
    expect(serialized).toContain('11987654321');
    expect(serialized).not.toContain('enc_v1:');
    expect(serialized).toContain('identity-document');
  });

  it('clears cpf and phone and removes documents on anonymization', async () => {
    const { user } = await createUser({ verified: true });
    // anonymizeUser only proceeds past a `status === 'deleted'` guard (see
    // anonymize.ts:32), matching every other call site of anonymizeUser in
    // this repo (see test/account-deletion/worker.test.ts). The brief's test
    // text omitted this precondition; without it anonymizeUser short-circuits
    // with { ok: false, error: 'user_not_deleted' } regardless of this task's
    // changes, so it is added here to actually exercise the code under test.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
        cpf: encryptField('52998224725', loadEnv().FIELD_ENCRYPTION_KEY),
        phone: '11987654321',
      },
    });
    const objectKey = `identity-document/${user.id}/a.jpg`;
    await prisma.userDocument.create({ data: { userId: user.id, type: 'cnh', objectKey } });

    // anonymizeUser(userId, uploads, priorSteps?) — see anonymize.ts:19.
    const result = await anonymizeUser(user.id, new DevUploads());
    expect(result.ok).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.cpf).toBeNull();
    expect(row.phone).toBeNull();
    expect(await prisma.userDocument.count({ where: { userId: user.id } })).toBe(0);
    const queued = await prisma.uploadDeletionQueue.findUnique({ where: { objectKey } });
    expect(queued).not.toBeNull();
  });

  it('purges an approved document file after its retention window', async () => {
    const { user } = await createUser({ verified: true });
    const objectKey = `identity-document/${user.id}/old-approved.jpg`;
    const doc = await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey,
        status: 'approved',
        reviewedAt: daysAgo(DOCUMENT_APPROVED_RETENTION_DAYS + 1),
      },
    });

    const purged = await purgeExpiredDocumentFiles(new Date());
    expect(purged).toBe(1);

    const row = await prisma.userDocument.findUniqueOrThrow({ where: { id: doc.id } });
    // Row survives for audit; only the object goes.
    expect(row.fileDeletedAt).not.toBeNull();
    expect(await prisma.uploadDeletionQueue.findUnique({ where: { objectKey } })).not.toBeNull();
  });

  it('queues the object to leave R2 immediately, not 30 more days after the published window', async () => {
    const { user } = await createUser({ verified: true });
    const objectKey = `identity-document/${user.id}/overdue-approved.jpg`;
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey,
        status: 'approved',
        reviewedAt: daysAgo(DOCUMENT_APPROVED_RETENTION_DAYS + 1),
      },
    });

    const now = new Date();
    expect(await purgeExpiredDocumentFiles(now)).toBe(1);

    // The 90/30-day windows ARE the grace period. If queueObjectDeletion's
    // own 30-day default were still in effect, deleteAfter would be 30 days
    // in the future here, and the object would sit in R2 for a month after
    // fileDeletedAt already told the app (and the data subject) it was gone.
    const queued = await prisma.uploadDeletionQueue.findUniqueOrThrow({ where: { objectKey } });
    expect(queued.deleteAfter.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('purges a rejected document file on the shorter window', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/old-rejected.jpg`,
        status: 'rejected',
        rejectionReason: 'Foto ilegível',
        reviewedAt: daysAgo(DOCUMENT_REJECTED_RETENTION_DAYS + 1),
      },
    });
    expect(await purgeExpiredDocumentFiles(new Date())).toBe(1);
  });

  it('leaves a fresh decision and a pending document alone', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/fresh.jpg`,
        status: 'approved',
        reviewedAt: daysAgo(1),
      },
    });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'rg',
        objectKey: `identity-document/${user.id}/pending.jpg`,
      },
    });
    expect(await purgeExpiredDocumentFiles(new Date())).toBe(0);
  });

  it('is idempotent — an already-purged row is not re-queued', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        type: 'cnh',
        objectKey: `identity-document/${user.id}/done.jpg`,
        status: 'approved',
        reviewedAt: daysAgo(DOCUMENT_APPROVED_RETENTION_DAYS + 1),
        fileDeletedAt: daysAgo(1),
      },
    });
    expect(await purgeExpiredDocumentFiles(new Date())).toBe(0);
  });
});
