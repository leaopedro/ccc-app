import { describe, expect, it } from 'vitest';

import { scrubSentryEvent, type SentryEvent } from '../sentry-scrubber.js';

describe('scrubSentryEvent', () => {
  it('strips unsafe request headers and keeps safe ones', () => {
    const event: SentryEvent = {
      request: {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret',
          'x-request-id': 'abc-123',
          'x-custom': 'nope',
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.headers).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'abc-123',
    });
  });

  it('strips referer header', () => {
    const event: SentryEvent = {
      request: {
        headers: {
          referer: 'https://admin.jdm.app/users/123?token=secret',
          'content-type': 'text/html',
        },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.headers).toEqual({ 'content-type': 'text/html' });
  });

  it('removes cookies from request', () => {
    const event: SentryEvent = {
      request: { cookies: { session: 'abc' } },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.cookies).toBeUndefined();
  });

  it('removes request body (data)', () => {
    const event: SentryEvent = {
      request: { data: { password: 'hunter2' } },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.data).toBeUndefined();
  });

  it('removes query_string from request', () => {
    const event: SentryEvent = {
      request: { query_string: 'token=secret&foo=bar' },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.query_string).toBeUndefined();
  });

  it('deletes user email and preserves other user fields', () => {
    const event: SentryEvent = {
      user: { email: 'alice@example.com', id: 'u_42' },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.user!.email).toBeUndefined();
    expect(scrubbed.user!.id).toBe('u_42');
  });

  it('truncates long breadcrumb messages', () => {
    const longMsg = 'a'.repeat(300);
    const event: SentryEvent = {
      breadcrumbs: [{ message: longMsg }],
    };

    const scrubbed = scrubSentryEvent(event);
    const bc = scrubbed.breadcrumbs;
    expect(bc).toHaveLength(1);
    const msg = bc![0]!.message!;

    expect(msg.length).toBeLessThanOrEqual(215);
    expect(msg).toContain('…[truncated]');
  });

  it('keeps short breadcrumb messages intact', () => {
    const event: SentryEvent = {
      breadcrumbs: [{ message: 'clicked button' }],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.breadcrumbs).toHaveLength(1);
    expect(scrubbed.breadcrumbs![0]!.message).toBe('clicked button');
  });

  it('strips breadcrumb data payloads', () => {
    const event: SentryEvent = {
      breadcrumbs: [{ message: 'nav', data: { url: '/secret' } }],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.breadcrumbs).toHaveLength(1);
    expect(scrubbed.breadcrumbs![0]!.data).toBeUndefined();
  });

  it('strips query params from request URL', () => {
    const event: SentryEvent = {
      request: { url: 'https://api.jdm.app/events?token=secret&email=a@b.com' },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.url).toBe('https://api.jdm.app/events');
  });

  it('preserves request URL without query params', () => {
    const event: SentryEvent = {
      request: { url: 'https://api.jdm.app/events/123' },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request!.url).toBe('https://api.jdm.app/events/123');
  });

  it('passes through events with no PII fields', () => {
    const event: SentryEvent = {
      extra: { build: '1.2.3' },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed).toEqual(event);
  });

  it('does not mutate the original event', () => {
    const event: SentryEvent = {
      request: {
        headers: { authorization: 'Bearer x' },
        cookies: { sid: '123' },
        data: { cpf: '123.456.789-00' },
        query_string: 'token=abc',
      },
      user: { email: 'bob@test.com' },
      breadcrumbs: [{ message: 'click', data: { target: '#btn' } }],
    };

    const snapshot = JSON.parse(JSON.stringify(event)) as SentryEvent;
    scrubSentryEvent(event);

    expect(event).toEqual(snapshot);
  });
});
