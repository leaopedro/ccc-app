import { describe, expect, it, vi } from 'vitest';

import { resolveWebResume } from './resume-web-checkout';

const NOW = new Date('2026-05-13T20:00:00.000Z');
const FUTURE = '2026-05-13T20:10:00.000Z';
const PAST = '2026-05-13T19:50:00.000Z';

describe('resolveWebResume', () => {
  it('returns redirect when URL stored, order pending, and expiresAt is in the future', async () => {
    const result = await resolveWebResume('order-1', {
      getStoredUrl: () => 'https://checkout.stripe.test/sess',
      fetchOrderStatus: vi.fn().mockResolvedValue({ status: 'pending', expiresAt: FUTURE }),
      now: () => NOW,
    });
    expect(result).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.test/sess' });
  });

  it('returns redirect when expiresAt is null (no reservation TTL)', async () => {
    const result = await resolveWebResume('order-1', {
      getStoredUrl: () => 'https://checkout.stripe.test/sess',
      fetchOrderStatus: vi.fn().mockResolvedValue({ status: 'pending', expiresAt: null }),
      now: () => NOW,
    });
    expect(result.kind).toBe('redirect');
  });

  it('returns stale when no URL is stored and never calls fetch', async () => {
    const fetchOrderStatus = vi.fn();
    const result = await resolveWebResume('order-1', {
      getStoredUrl: () => null,
      fetchOrderStatus,
      now: () => NOW,
    });
    expect(result).toEqual({ kind: 'stale' });
    expect(fetchOrderStatus).not.toHaveBeenCalled();
  });

  it('returns stale for every non-pending terminal status', async () => {
    for (const status of ['paid', 'cancelled', 'expired', 'failed', 'refunded']) {
      const result = await resolveWebResume('order-1', {
        getStoredUrl: () => 'https://checkout.stripe.test/sess',
        fetchOrderStatus: vi.fn().mockResolvedValue({ status, expiresAt: FUTURE }),
        now: () => NOW,
      });
      expect(result).toEqual({ kind: 'stale' });
    }
  });

  it('returns stale when reservation expiresAt is in the past even if status still says pending', async () => {
    const result = await resolveWebResume('order-1', {
      getStoredUrl: () => 'https://checkout.stripe.test/sess',
      fetchOrderStatus: vi.fn().mockResolvedValue({ status: 'pending', expiresAt: PAST }),
      now: () => NOW,
    });
    expect(result).toEqual({ kind: 'stale' });
  });

  it('returns stale when expiresAt is exactly now (boundary)', async () => {
    const result = await resolveWebResume('order-1', {
      getStoredUrl: () => 'https://checkout.stripe.test/sess',
      fetchOrderStatus: vi
        .fn()
        .mockResolvedValue({ status: 'pending', expiresAt: NOW.toISOString() }),
      now: () => NOW,
    });
    expect(result).toEqual({ kind: 'stale' });
  });

  it('returns unverified when fetchOrderStatus throws (transient failure — caller must keep URL)', async () => {
    const result = await resolveWebResume('order-1', {
      getStoredUrl: () => 'https://checkout.stripe.test/sess',
      fetchOrderStatus: vi.fn().mockRejectedValue(new Error('network')),
      now: () => NOW,
    });
    expect(result).toEqual({ kind: 'unverified' });
  });
});
