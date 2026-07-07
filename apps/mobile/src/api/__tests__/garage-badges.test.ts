// Mobile API client tests for the chunk 19 badges helpers. Covers wire-format
// + URL shape so chunk 19's pin-toggle UX is grounded on the real PATCH path
// (`/me/garage/badges/:code/pin`) rather than the orchestrator-summary path
// `/me/garage/badges/:code` (which does not exist on the API).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiBaseUrl: 'https://api.test' } } },
}));

const { getMyBadges, togglePinBadge } = await import('../garage');
const { registerTokenProvider } = await import('../client');

describe('mobile garage-badges API client', () => {
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

  it('GETs /me/garage/badges and parses the owner aggregate', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          enabled: true,
          catalog: [
            {
              code: 'EVT-001',
              category: 'eventos',
              rarity: 'common',
              premiumExclusive: false,
              icon: 'flag',
            },
          ],
          badges: [
            {
              code: 'EVT-001',
              state: 'earned',
              earnedAt: '2026-02-10T11:30:00.000Z',
              pinned: true,
              pinnedAt: '2026-02-10T11:30:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await getMyBadges();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/me/garage/badges');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-123');
    expect(result.enabled).toBe(true);
    expect(result.badges).toHaveLength(1);
    expect(result.catalog).toHaveLength(1);
  });

  it('PATCHes /me/garage/badges/:code/pin with { pinned } and parses badge row', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          badge: {
            code: 'EVT-001',
            earnedAt: '2026-02-10T11:30:00.000Z',
            pinned: true,
            pinnedAt: '2026-05-24T10:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await togglePinBadge('EVT-001', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Path includes the badge code under /pin — NOT a bare /me/garage/badges/:code.
    // Catching an orchestrator-note URL drift here is the whole point of this test.
    expect(url).toBe('https://api.test/me/garage/badges/EVT-001/pin');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse((init.body as string) ?? '{}')).toEqual({ pinned: true });
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(result.badge.code).toBe('EVT-001');
    expect(result.badge.pinned).toBe(true);
  });

  it('PATCH path URL-encodes the badge code', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          badge: {
            code: 'JDM-003',
            earnedAt: '2026-02-10T11:30:00.000Z',
            pinned: false,
            pinnedAt: null,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await togglePinBadge('JDM-003', false);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/me/garage/badges/JDM-003/pin');
  });
});
