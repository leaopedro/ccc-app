// Mobile API client tests for the celebration queue (task 9). Covers the two
// new endpoints (GET .../celebrations, POST .../celebrations/ack) plus the
// copy mirror check: badgesCopy.badges.celebration must exist with the same
// keys in both ptBR and en, since task 7's BadgeCelebrationCopy is consumed
// directly by packages/ui's BadgeCelebration component.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same guard as garage-badges.test.ts: ../client imports react-native
// directly (x-ccc-platform header), whose Flow-flavored `import typeof`
// syntax vitest's SSR transform cannot parse.
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: 'https://api.test' } } },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { listCelebrations, ackCelebrations } = await import('../garage');
const { registerTokenProvider } = await import('../client');
const { badgesCopy, badgesCopyEn } = await import('../../copy/badges');

describe('mobile celebrations API client', () => {
  const fetchMock = vi.fn();
  const original = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    registerTokenProvider({
      getAccessToken: () => 'token-123',
      refresh: vi.fn().mockResolvedValue('token-123'),
      onSignOut: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('GETs /me/garage/badges/celebrations and validates the response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          enabled: true,
          pending: [{ code: 'EVT-001', earnedAt: '2026-09-13T12:00:00.000Z' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await listCelebrations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/me/garage/badges/celebrations');
    expect(init.method).toBe('GET');
    expect(result.enabled).toBe(true);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.code).toBe('EVT-001');
  });

  it('POSTs the ack with { codes } in the body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ acked: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await ackCelebrations(['EVT-001', 'CAR-001']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/me/garage/badges/celebrations/ack');
    expect(init.method).toBe('POST');
    expect(JSON.parse((init.body as string) ?? '{}')).toEqual({
      codes: ['EVT-001', 'CAR-001'],
    });
    expect(result.acked).toBe(2);
  });

  it('rejects an empty codes list before any network call', async () => {
    await expect(ackCelebrations([])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an over-sized codes list (>10) before any network call', async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `EVT-00${i}`);
    await expect(ackCelebrations(tooMany)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mirrors the celebration copy keys between ptBR and en', () => {
    expect(Object.keys(badgesCopy.badges.celebration).sort()).toEqual(
      Object.keys(badgesCopyEn.badges.celebration).sort(),
    );
    expect(typeof badgesCopy.badges.celebration.titleMany).toBe('function');
    expect(typeof badgesCopyEn.badges.celebration.titleMany).toBe('function');
    expect(typeof badgesCopy.badges.celebration.more).toBe('function');
    expect(typeof badgesCopyEn.badges.celebration.more).toBe('function');
  });
});
