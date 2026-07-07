import type { NotificationDestination } from '@jdm/shared/notifications';
import { Linking } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDestination, openDestination } from '../destination';

import { captureException } from '~/lib/sentry';

vi.mock('react-native', () => ({
  Linking: {
    canOpenURL: vi.fn(),
    openURL: vi.fn(),
  },
}));

vi.mock('~/lib/sentry', () => ({
  captureException: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method
const canOpen = vi.mocked(Linking.canOpenURL);
// eslint-disable-next-line @typescript-eslint/unbound-method
const openURL = vi.mocked(Linking.openURL);
const capture = vi.mocked(captureException);

describe('resolveDestination', () => {
  it('returns none for null', () => {
    expect(resolveDestination(null)).toEqual({ kind: 'none' });
  });

  it('returns none for kind=none', () => {
    expect(resolveDestination({ kind: 'none' })).toEqual({ kind: 'none' });
  });

  it('resolves tickets', () => {
    expect(resolveDestination({ kind: 'tickets' })).toEqual({ kind: 'internal', path: '/tickets' });
  });

  it('resolves event', () => {
    const dest: NotificationDestination = { kind: 'event', eventId: 'evt_abc' };
    expect(resolveDestination(dest)).toEqual({ kind: 'internal', path: '/events/evt_abc' });
  });

  it('resolves product', () => {
    const dest: NotificationDestination = { kind: 'product', productId: 'prod_xyz' };
    expect(resolveDestination(dest)).toEqual({ kind: 'internal', path: '/store/prod_xyz' });
  });

  it('resolves internal_path', () => {
    const dest: NotificationDestination = { kind: 'internal_path', path: '/tickets' };
    expect(resolveDestination(dest)).toEqual({ kind: 'internal', path: '/tickets' });
  });

  it('resolves external_url', () => {
    const dest: NotificationDestination = { kind: 'external_url', url: 'https://example.com' };
    expect(resolveDestination(dest)).toEqual({ kind: 'external', url: 'https://example.com' });
  });
});

describe('openDestination', () => {
  const push = vi.fn();

  beforeEach(() => {
    push.mockReset();
    canOpen.mockReset();
    openURL.mockReset();
    capture.mockReset();
  });

  it('does nothing for null destination', async () => {
    await openDestination(null, push);
    expect(push).not.toHaveBeenCalled();
  });

  it('calls push for internal destination', async () => {
    await openDestination({ kind: 'tickets' }, push);
    expect(push).toHaveBeenCalledWith('/tickets');
  });

  it('opens external URL when supported', async () => {
    canOpen.mockResolvedValue(true);
    openURL.mockResolvedValue(undefined);
    await openDestination({ kind: 'external_url', url: 'https://example.com' }, push);
    expect(openURL).toHaveBeenCalledWith('https://example.com');
    expect(push).not.toHaveBeenCalled();
  });

  it('captures error and does not open when URL not supported', async () => {
    canOpen.mockResolvedValue(false);
    await openDestination({ kind: 'external_url', url: 'https://example.com' }, push);
    expect(openURL).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalled();
  });

  it('captures error on Linking.openURL failure', async () => {
    canOpen.mockResolvedValue(true);
    openURL.mockRejectedValue(new Error('open failed'));
    await openDestination({ kind: 'external_url', url: 'https://example.com' }, push);
    expect(capture).toHaveBeenCalled();
  });
});
