import { ACCOUNT_DISABLED_ERROR } from '@jdm/shared/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { ApiError, authedRequest, registerTokenProvider } = await import('../client');

const schema = z.object({ ok: z.boolean() });

describe('authedRequest — AccountDisabled handling', () => {
  const fetchMock = vi.fn();
  const original = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('triggers onAccountDisabled and skips refresh when 401 body says AccountDisabled', async () => {
    const onAccountDisabled = vi.fn().mockResolvedValue(undefined);
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue('new-token');
    registerTokenProvider({
      getAccessToken: () => 'old-token',
      refresh,
      onSignOut,
      onAccountDisabled,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: ACCOUNT_DISABLED_ERROR, message: 'account is disabled' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(authedRequest('/v1/me', schema)).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });

    expect(onAccountDisabled).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to refresh on 401 without AccountDisabled marker', async () => {
    const onAccountDisabled = vi.fn().mockResolvedValue(undefined);
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue('new-token');
    registerTokenProvider({
      getAccessToken: () => 'old-token',
      refresh,
      onSignOut,
      onAccountDisabled,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized', message: 'expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await authedRequest('/v1/me', schema);
    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onAccountDisabled).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('falls back to onSignOut when onAccountDisabled is not registered', async () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();
    registerTokenProvider({
      getAccessToken: () => 'old-token',
      refresh,
      onSignOut,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: ACCOUNT_DISABLED_ERROR, message: 'account is disabled' }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(authedRequest('/v1/me', schema)).rejects.toBeInstanceOf(ApiError);
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
