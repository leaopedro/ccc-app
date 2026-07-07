import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from './middleware';

const makeRequest = (path: string, cookie?: string): NextRequest =>
  cookie
    ? new NextRequest(`https://jdm-admin-eight.vercel.app${path}`, {
        headers: { cookie },
      })
    : new NextRequest(`https://jdm-admin-eight.vercel.app${path}`);

describe('admin auth middleware', () => {
  it('allows login when only role cookie exists', () => {
    const res = middleware(makeRequest('/login', 'session_role=admin'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects authenticated users away from login', () => {
    const res = middleware(
      makeRequest('/login', 'session_role=admin; session_refresh=valid_refresh_token'),
    );
    expect(res.headers.get('location')).toBe('https://jdm-admin-eight.vercel.app/events');
  });

  it('forces reauth path and clears auth cookies', () => {
    const res = middleware(
      makeRequest(
        '/login?reauth=1',
        'session_role=admin; session_access=old_access; session_refresh=old_refresh',
      ),
    );
    expect(res.headers.get('location')).toBeNull();

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('session_access=');
    expect(setCookie).toContain('session_refresh=');
    expect(setCookie).toContain('session_role=');
    expect(setCookie).toContain('Path=/');
  });

  it('redirects guests from protected pages to login', () => {
    const res = middleware(makeRequest('/events'));
    expect(res.headers.get('location')).toBe('https://jdm-admin-eight.vercel.app/login');
  });

  it('x-middleware-subrequest header does not bypass auth gate', () => {
    const req = new NextRequest('https://jdm-admin-eight.vercel.app/events', {
      headers: { 'x-middleware-subrequest': 'middleware:middleware:middleware' },
    });
    const res = middleware(req);
    expect(res.headers.get('location')).toBe('https://jdm-admin-eight.vercel.app/login');
  });
});
