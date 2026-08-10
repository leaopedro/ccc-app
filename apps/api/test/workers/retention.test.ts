import { prisma } from '@ccc/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Uploads } from '../../src/services/uploads/index.js';
import { runRetentionTick } from '../../src/workers/retention.js';
import { createUser, resetDatabase } from '../helpers.js';

const MS_PER_DAY = 24 * 3600_000;

describe('runRetentionTick', () => {
  const deleteObjectSpy = vi.fn((_key: string) => Promise.resolve());
  const uploads: Uploads = {
    deleteObject: deleteObjectSpy,
    presignPut: vi.fn(() => Promise.reject(new Error('not used in retention tests'))),
    presignGet: vi.fn(() => Promise.reject(new Error('not used in retention tests'))),
    buildPublicUrl: vi.fn(() => 'https://example.test/object'),
    buildSignedGetUrl: vi.fn(() => Promise.resolve('https://example.test/object?signed=1')),
    isOwnedKey: vi.fn(() => true),
    isKindKey: vi.fn(() => true),
  };

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deletes refresh tokens expired more than 7 days ago', async () => {
    const { user } = await createUser({ verified: true });
    const old = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'old-hash',
        expiresAt: new Date(Date.now() - 8 * MS_PER_DAY),
      },
    });
    const fresh = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'fresh-hash',
        expiresAt: new Date(Date.now() + MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const rt = results.find((r) => r.table === 'RefreshToken')!;
    expect(rt.deletedCount).toBe(1);
    expect(await prisma.refreshToken.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it('keeps revoked refresh tokens until 7 days after revocation', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'revoked-hash',
        expiresAt: new Date(Date.now() + MS_PER_DAY),
        revokedAt: new Date(),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const rt = results.find((r) => r.table === 'RefreshToken')!;
    expect(rt.deletedCount).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(1);
  });

  it('deletes revoked refresh tokens after 7 days from revocation', async () => {
    const now = new Date();
    const { user } = await createUser({ verified: true });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'revoked-old-hash',
        expiresAt: new Date(now.getTime() + 30 * MS_PER_DAY),
        revokedAt: new Date(now.getTime() - 8 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now, uploads });

    const rt = results.find((r) => r.table === 'RefreshToken')!;
    expect(rt.deletedCount).toBe(1);
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('deletes expired verification tokens', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: 'expired-vt',
        expiresAt: new Date(Date.now() - MS_PER_DAY),
      },
    });
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: 'active-vt',
        expiresAt: new Date(Date.now() + MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const vt = results.find((r) => r.table === 'VerificationToken')!;
    expect(vt.deletedCount).toBe(1);
    expect(await prisma.verificationToken.count()).toBe(1);
  });

  it('deletes consumed verification tokens even if not expired', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: 'consumed-vt',
        expiresAt: new Date(Date.now() + MS_PER_DAY),
        consumedAt: new Date(),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const vt = results.find((r) => r.table === 'VerificationToken')!;
    expect(vt.deletedCount).toBe(1);
  });

  it('deletes expired password reset tokens', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: 'expired-prt',
        expiresAt: new Date(Date.now() - MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const prt = results.find((r) => r.table === 'PasswordResetToken')!;
    expect(prt.deletedCount).toBe(1);
  });

  it('deletes webhook events older than 90 days', async () => {
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_old',
        payload: {},
        createdAt: new Date(Date.now() - 91 * MS_PER_DAY),
      },
    });
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_recent',
        payload: {},
        createdAt: new Date(Date.now() - 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const pwe = results.find((r) => r.table === 'PaymentWebhookEvent')!;
    expect(pwe.deletedCount).toBe(1);
    expect(await prisma.paymentWebhookEvent.count()).toBe(1);
  });

  it('skips webhook events with active retention hold', async () => {
    const now = new Date();
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_held',
        payload: {},
        createdAt: new Date(now.getTime() - 91 * MS_PER_DAY),
        retentionHoldUntil: new Date(now.getTime() + 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now, uploads });

    const pwe = results.find((r) => r.table === 'PaymentWebhookEvent')!;
    expect(pwe.deletedCount).toBe(0);
    expect(pwe.skippedHolds).toBe(1);
    expect(await prisma.paymentWebhookEvent.count()).toBe(1);
  });

  it('deletes webhook events with expired retention hold', async () => {
    const now = new Date();
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_hold_expired',
        payload: {},
        createdAt: new Date(now.getTime() - 91 * MS_PER_DAY),
        retentionHoldUntil: new Date(now.getTime() - MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now, uploads });

    const pwe = results.find((r) => r.table === 'PaymentWebhookEvent')!;
    expect(pwe.deletedCount).toBe(1);
  });

  it('deletes notifications older than 90 days', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'event.reminder_24h',
        title: 'Old',
        body: 'old notification',
        data: {},
        dedupeKey: 'old-key',
        createdAt: new Date(Date.now() - 91 * MS_PER_DAY),
      },
    });
    await prisma.notification.create({
      data: {
        userId: user.id,
        kind: 'event.reminder_1h',
        title: 'Recent',
        body: 'recent notification',
        data: {},
        dedupeKey: 'recent-key',
        createdAt: new Date(Date.now() - 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const n = results.find((r) => r.table === 'Notification')!;
    expect(n.deletedCount).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('scrubs IP/user-agent from consents older than 90 days, keeping the record', async () => {
    const { user } = await createUser({ verified: true });
    const old = await prisma.consent.create({
      data: {
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '203.0.113.7',
        userAgent: 'ExpoClient/1.0',
        evidence: {},
        givenAt: new Date(Date.now() - 91 * MS_PER_DAY),
      },
    });
    const recent = await prisma.consent.create({
      data: {
        userId: user.id,
        purpose: 'newsletter',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '203.0.113.8',
        userAgent: 'ExpoClient/1.0',
        evidence: {},
        givenAt: new Date(Date.now() - 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const c = results.find((r) => r.table === 'Consent')!;
    expect(c.deletedCount).toBe(1);
    const oldAfter = await prisma.consent.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldAfter.ipAddress).toBeNull();
    expect(oldAfter.userAgent).toBeNull();
    const recentAfter = await prisma.consent.findUniqueOrThrow({ where: { id: recent.id } });
    expect(recentAfter.ipAddress).toBe('203.0.113.8');
  });

  it('deletes support tickets closed over 2 years ago and queues their attachments', async () => {
    const { user } = await createUser({ verified: true });
    const old = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        phone: '+5541999990000',
        message: 'old ticket',
        attachmentObjectKey: 'support/old-attachment.jpg',
        status: 'closed',
        closedAt: new Date(Date.now() - 731 * MS_PER_DAY),
      },
    });
    const recent = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        phone: '+5541999990001',
        message: 'recent ticket',
        status: 'closed',
        closedAt: new Date(Date.now() - 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const s = results.find((r) => r.table === 'SupportTicket')!;
    expect(s.deletedCount).toBe(1);
    expect(await prisma.supportTicket.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.supportTicket.findUnique({ where: { id: recent.id } })).not.toBeNull();
    // Enqueued and consumed in the same tick (see purgeOldSupportTickets): the
    // UploadDeletionQueue pass deletes the R2 object and removes the queue row.
    expect(deleteObjectSpy).toHaveBeenCalledWith('support/old-attachment.jpg');
    const queued = await prisma.uploadDeletionQueue.findUnique({
      where: { objectKey: 'support/old-attachment.jpg' },
    });
    expect(queued).toBeNull();
  });

  it('deletes admin audit rows older than 2 years', async () => {
    const oldId = 'old-audit-fixture';
    await prisma.adminAudit.create({
      data: {
        id: oldId,
        actorId: 'admin-1',
        action: 'test.action',
        entityType: 'test',
        entityId: 'x',
        createdAt: new Date(Date.now() - 731 * MS_PER_DAY),
      },
    });

    await runRetentionTick({ now: new Date(), uploads });

    expect(await prisma.adminAudit.findUnique({ where: { id: oldId } })).toBeNull();
  });

  it('deletes subscription webhook events older than 90 days', async () => {
    const old = await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: 'apple_revenuecat',
        providerEventId: 'evt_old_1',
        type: 'INITIAL_PURCHASE',
        payload: {},
        receivedAt: new Date(Date.now() - 91 * MS_PER_DAY),
      },
    });
    const recent = await prisma.subscriptionWebhookEvent.create({
      data: {
        provider: 'apple_revenuecat',
        providerEventId: 'evt_recent_1',
        type: 'RENEWAL',
        payload: {},
        receivedAt: new Date(Date.now() - 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const w = results.find((r) => r.table === 'SubscriptionWebhookEvent')!;
    expect(w.deletedCount).toBe(1);
    expect(await prisma.subscriptionWebhookEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(
      await prisma.subscriptionWebhookEvent.findUnique({ where: { id: recent.id } }),
    ).not.toBeNull();
  });

  it('deletes broadcast deliveries older than 1 year', async () => {
    const { user } = await createUser({ verified: true });
    const { user: user2 } = await createUser({ verified: true, email: 'user2@jdm.test' });
    const broadcast = await prisma.broadcast.create({
      data: {
        title: 'Test broadcast',
        body: 'body',
        targetKind: 'all',
        status: 'sent',
        createdByAdminId: user.id,
      },
    });
    await prisma.broadcastDelivery.create({
      data: {
        broadcastId: broadcast.id,
        userId: user.id,
        status: 'sent',
        createdAt: new Date(Date.now() - 366 * MS_PER_DAY),
      },
    });
    await prisma.broadcastDelivery.create({
      data: {
        broadcastId: broadcast.id,
        userId: user2.id,
        status: 'sent',
        createdAt: new Date(Date.now() - 30 * MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now: new Date(), uploads });

    const bd = results.find((r) => r.table === 'BroadcastDelivery')!;
    expect(bd.deletedCount).toBe(1);
    expect(await prisma.broadcastDelivery.count()).toBe(1);
  });

  it('writes audit record when rows are purged', async () => {
    const { user } = await createUser({ verified: true });
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'audit-test',
        expiresAt: new Date(Date.now() - 8 * MS_PER_DAY),
      },
    });

    await runRetentionTick({ now: new Date(), uploads });

    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: 'system:retention', action: 'retention.purge' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe('retention_run');
    const meta = audit!.metadata as Record<string, { deleted: number } | undefined>;
    expect(meta.RefreshToken?.deleted).toBe(1);
  });

  it('writes audit record even when nothing is purged', async () => {
    await runRetentionTick({ now: new Date(), uploads });

    const audit = await prisma.adminAudit.findFirst({
      where: { actorId: 'system:retention', action: 'retention.purge' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entityType).toBe('retention_run');
    const meta = audit!.metadata as Record<string, { deleted: number } | undefined>;
    expect(meta.RefreshToken?.deleted).toBe(0);
  });
  it('deletes queued object keys whose deleteAfter is due', async () => {
    const now = new Date();
    await prisma.uploadDeletionQueue.create({
      data: {
        objectKey: 'avatar/user-1/old.png',
        reason: 'avatar_replaced',
        deleteAfter: new Date(now.getTime() - 1000),
      },
    });
    await prisma.uploadDeletionQueue.create({
      data: {
        objectKey: 'car_photo/user-1/future.png',
        reason: 'car_photo_deleted',
        deleteAfter: new Date(now.getTime() + MS_PER_DAY),
      },
    });

    const results = await runRetentionTick({ now, uploads });

    const queued = results.find((r) => r.table === 'UploadDeletionQueue')!;
    expect(queued.deletedCount).toBe(1);
    expect(queued.failedCount).toBe(0);
    expect(deleteObjectSpy).toHaveBeenCalledWith('avatar/user-1/old.png');
    expect(await prisma.uploadDeletionQueue.count()).toBe(1);
  });
});
