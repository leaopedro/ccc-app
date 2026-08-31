import { describe, expect, it, vi } from 'vitest';

// ../api/client imports react-native directly (for the x-ccc-platform
// header), whose Flow-flavored `import typeof` syntax vitest's SSR transform
// cannot parse. Mock it before importing.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { ApiError } = await import('../api/client');
const { isStoreAvailable, isStoreDisabledError, resolveStoreSlot } = await import('./runtime');

describe('isStoreDisabledError', () => {
  it('detects the backend killswitch response', () => {
    const error = new ApiError(503, 'request failed', {
      error: 'ServiceUnavailable',
      message: 'store is currently disabled',
    });

    expect(isStoreDisabledError(error)).toBe(true);
  });

  it('ignores unrelated service-unavailable responses', () => {
    const error = new ApiError(503, 'request failed', {
      error: 'ServiceUnavailable',
      message: 'pix provider not configured',
    });

    expect(isStoreDisabledError(error)).toBe(false);
  });

  it('ignores non-api errors', () => {
    expect(isStoreDisabledError(new Error('boom'))).toBe(false);
  });
});

describe('store runtime visibility', () => {
  it('shows store optimistically until a probe completes (null state)', () => {
    expect(isStoreAvailable(null)).toBe(true);
    expect(resolveStoreSlot(null)).toBe('store');
  });

  it('replaces Loja with Ingressos when the runtime killswitch is off', () => {
    expect(isStoreAvailable(false)).toBe(false);
    expect(resolveStoreSlot(false)).toBe('tickets');
  });

  it('keeps the normal store nav when the runtime killswitch is on', () => {
    expect(isStoreAvailable(true)).toBe(true);
    expect(resolveStoreSlot(true)).toBe('store');
  });
});
