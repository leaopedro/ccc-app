import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// expo-constants (imported by ../client) transitively pulls in react-native,
// whose Flow-flavored `import typeof` syntax vitest's SSR transform cannot
// parse. Mock both before importing, same as
// api/__tests__/account-disabled.test.ts and api/__tests__/errors.test.ts.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { Platform } = await import('react-native');
const { authedRequest, registerTokenProvider, request } = await import('../client');

const okResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);

describe('api client platform header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends x-ccc-platform on unauthed requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse({ ok: 1 }));

    await request('/api/plans', z.object({ ok: z.number() }));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-ccc-platform']).toBe(Platform.OS);
  });

  it('sends x-ccc-platform on authed requests', async () => {
    registerTokenProvider({
      getAccessToken: () => 'token-123',
      refresh: vi.fn(),
      onSignOut: vi.fn(),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse({ ok: 1 }));

    await authedRequest('/api/me', z.object({ ok: z.number() }));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-ccc-platform']).toBe(Platform.OS);
  });
});
