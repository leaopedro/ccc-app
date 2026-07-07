import { prisma } from '@jdm/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  hasActiveConsent,
  listUserConsents,
  recordConsent,
  withdrawConsent,
} from '../../src/services/consent.js';
import { createUser, resetDatabase } from '../helpers.js';

describe('consent service', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    // noop
  });

  describe('recordConsent', () => {
    it('creates a new consent row', async () => {
      const { user } = await createUser({ verified: true });
      const result = await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1-2026-05-14',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true, text: 'Aceito receber notificações de marketing' },
      });

      expect(result.id).toBeDefined();
      expect(result.purpose).toBe('push_marketing');
      expect(result.version).toBe('v1-2026-05-14');
      expect(result.withdrawnAt).toBeNull();
    });

    it('is idempotent on (userId, purpose, version)', async () => {
      const { user } = await createUser({ verified: true });
      const params = {
        userId: user.id,
        purpose: 'push_marketing' as const,
        version: 'v1-2026-05-14',
        channel: 'mobile' as const,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      };

      const first = await recordConsent(params);
      const second = await recordConsent(params);
      expect(first.id).toBe(second.id);

      const count = await prisma.consent.count({
        where: { userId: user.id, purpose: 'push_marketing' },
      });
      expect(count).toBe(1);
    });

    it('syncs pushPrefs.marketing to true on push_marketing grant', async () => {
      const { user } = await createUser({ verified: true });

      const before = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { pushPrefs: true },
      });
      expect((before.pushPrefs as Record<string, unknown>).marketing).toBe(false);

      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: null,
        userAgent: null,
        evidence: { checkbox: true },
      });

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { pushPrefs: true },
      });
      expect((after.pushPrefs as Record<string, unknown>).marketing).toBe(true);
    });

    it('concurrent grants produce exactly one active row', async () => {
      const { user } = await createUser({ verified: true });
      const params = {
        userId: user.id,
        purpose: 'push_marketing' as const,
        version: 'v1-concurrent',
        channel: 'mobile' as const,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      };

      const results = await Promise.all([
        recordConsent(params),
        recordConsent(params),
        recordConsent(params),
      ]);

      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(1);

      const count = await prisma.consent.count({
        where: { userId: user.id, purpose: 'push_marketing', version: 'v1-concurrent' },
      });
      expect(count).toBe(1);
    });

    it('re-granting after withdrawal creates a new row preserving audit trail', async () => {
      const { user } = await createUser({ verified: true });
      const params = {
        userId: user.id,
        purpose: 'email_marketing' as const,
        version: 'v1',
        channel: 'mobile' as const,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      };

      const first = await recordConsent(params);
      await withdrawConsent(user.id, 'email_marketing');
      const regranted = await recordConsent(params);

      // Re-grant must be a different row so the withdrawal is preserved
      expect(regranted.id).not.toBe(first.id);
      expect(regranted.withdrawnAt).toBeNull();

      // Original row must still have withdrawnAt set (audit trail intact)
      const original = await prisma.consent.findUniqueOrThrow({ where: { id: first.id } });
      expect(original.withdrawnAt).not.toBeNull();

      // Two rows total for this (userId, purpose, version)
      const count = await prisma.consent.count({
        where: { userId: user.id, purpose: 'email_marketing' },
      });
      expect(count).toBe(2);
    });
  });

  describe('withdrawConsent', () => {
    it('sets withdrawnAt on the active consent row', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });

      const result = await withdrawConsent(user.id, 'push_marketing');
      expect(result).toBe(true);

      const row = await prisma.consent.findFirst({
        where: { userId: user.id, purpose: 'push_marketing' },
      });
      expect(row?.withdrawnAt).not.toBeNull();
    });

    it('returns false when no active consent exists', async () => {
      const { user } = await createUser({ verified: true });
      const result = await withdrawConsent(user.id, 'push_marketing');
      expect(result).toBe(false);
    });

    it('withdraws ALL active versions, not just the latest', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: null,
        userAgent: null,
        evidence: { checkbox: true },
      });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v2',
        channel: 'mobile',
        ipAddress: null,
        userAgent: null,
        evidence: { checkbox: true },
      });

      const result = await withdrawConsent(user.id, 'push_marketing');
      expect(result).toBe(true);

      const active = await prisma.consent.count({
        where: { userId: user.id, purpose: 'push_marketing', withdrawnAt: null },
      });
      expect(active).toBe(0);
      expect(await hasActiveConsent(user.id, 'push_marketing')).toBe(false);
    });

    it('syncs pushPrefs.marketing to false on push_marketing withdrawal', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: null,
        userAgent: null,
        evidence: { checkbox: true },
      });

      const afterGrant = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { pushPrefs: true },
      });
      expect((afterGrant.pushPrefs as Record<string, unknown>).marketing).toBe(true);

      await withdrawConsent(user.id, 'push_marketing');

      const afterWithdraw = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { pushPrefs: true },
      });
      expect((afterWithdraw.pushPrefs as Record<string, unknown>).marketing).toBe(false);
    });
  });

  describe('hasActiveConsent', () => {
    it('returns true when consent is active', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });

      const result = await hasActiveConsent(user.id, 'push_marketing');
      expect(result).toBe(true);
    });

    it('returns false when consent is withdrawn', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });
      await withdrawConsent(user.id, 'push_marketing');

      const result = await hasActiveConsent(user.id, 'push_marketing');
      expect(result).toBe(false);
    });

    it('returns false when no consent row exists', async () => {
      const { user } = await createUser({ verified: true });
      const result = await hasActiveConsent(user.id, 'push_marketing');
      expect(result).toBe(false);
    });
  });

  describe('listUserConsents', () => {
    it('returns all consent records for the user', async () => {
      const { user } = await createUser({ verified: true });
      await recordConsent({
        userId: user.id,
        purpose: 'push_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });
      await recordConsent({
        userId: user.id,
        purpose: 'email_marketing',
        version: 'v1',
        channel: 'mobile',
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
        evidence: { checkbox: true },
      });

      const records = await listUserConsents(user.id);
      expect(records).toHaveLength(2);
      expect(records.map((r) => r.purpose).sort()).toEqual(['email_marketing', 'push_marketing']);
    });
  });
});
