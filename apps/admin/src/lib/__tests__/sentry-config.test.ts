import { describe, expect, it, vi } from 'vitest';

const { scrubSentryEvent } = vi.hoisted(() => ({
  scrubSentryEvent: vi.fn((e: unknown) => e),
}));

vi.mock('@jdm/shared/sentry-scrubber', () => ({ scrubSentryEvent }));

import { buildAdminSentryOptions } from '../sentry-config';

describe('buildAdminSentryOptions', () => {
  it('disabled when DSN is undefined', () => {
    const opts = buildAdminSentryOptions(undefined, 'client');
    expect(opts.enabled).toBe(false);
  });

  it('disabled when DSN is empty string', () => {
    const opts = buildAdminSentryOptions('', 'server');
    expect(opts.enabled).toBe(false);
  });

  it('enabled when DSN is present', () => {
    const opts = buildAdminSentryOptions('https://key@sentry.io/123', 'client');
    expect(opts.enabled).toBe(true);
    expect(opts.dsn).toBe('https://key@sentry.io/123');
  });

  it('service tag is always admin', () => {
    const opts = buildAdminSentryOptions('https://key@sentry.io/123', 'server');
    expect((opts.initialScope as { tags: Record<string, string> }).tags.service).toBe('admin');
  });

  it('runtime tag matches argument', () => {
    for (const runtime of ['client', 'server', 'edge'] as const) {
      const opts = buildAdminSentryOptions('https://key@sentry.io/123', runtime);
      expect((opts.initialScope as { tags: Record<string, string> }).tags.runtime).toBe(runtime);
    }
  });

  it('replay disabled on client until consent gate ships (T12)', () => {
    // replaysOnErrorSampleRate must stay 0 until per-user consent is recorded.
    // Re-enable only after JDMA-664 consent gate is wired (LIA-05 precondition).
    const client = buildAdminSentryOptions('https://key@sentry.io/123', 'client');
    expect(client.replaysOnErrorSampleRate).toBe(0);
    expect(client.replaysSessionSampleRate).toBe(0);

    const server = buildAdminSentryOptions('https://key@sentry.io/123', 'server');
    expect(server.replaysOnErrorSampleRate).toBeUndefined();
  });

  describe('beforeSend', () => {
    it('returns null when scrubber returns null', () => {
      scrubSentryEvent.mockReturnValueOnce(null);
      const opts = buildAdminSentryOptions('https://key@sentry.io/123', 'server');
      const beforeSend = opts.beforeSend as (e: object) => object | null;
      expect(beforeSend({ level: 'error' })).toBeNull();
    });

    it('strips console breadcrumbs containing email patterns', () => {
      scrubSentryEvent.mockImplementationOnce((e: unknown) => e);
      const opts = buildAdminSentryOptions('https://key@sentry.io/123', 'server');
      const beforeSend = opts.beforeSend as (e: object) => {
        breadcrumbs: { category: string; message: string }[];
      } | null;

      const result = beforeSend({
        level: 'error',
        breadcrumbs: [
          { category: 'console', message: 'user@example.com logged in' },
          { category: 'navigation', message: '/dashboard' },
        ],
      });

      expect(result).not.toBeNull();
      const categories = result!.breadcrumbs.map((b) => b.category);
      expect(categories).not.toContain('console');
      expect(categories).toContain('navigation');
    });

    it('keeps console breadcrumbs with no PII', () => {
      scrubSentryEvent.mockImplementationOnce((e: unknown) => e);
      const opts = buildAdminSentryOptions('https://key@sentry.io/123', 'server');
      const beforeSend = opts.beforeSend as (e: object) => {
        breadcrumbs: { category: string; message: string }[];
      } | null;

      const result = beforeSend({
        level: 'error',
        breadcrumbs: [{ category: 'console', message: 'Component mounted' }],
      });

      expect(result).not.toBeNull();
      expect(result!.breadcrumbs).toHaveLength(1);
    });
  });
});
