import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = {
  matcher: ['/', '/events/:path*', '/check-in/:path*', '/financeiro/:path*', '/login'],
};

type Role = 'organizer' | 'admin' | 'staff';

const isRole = (v: string | undefined): v is Role =>
  v === 'organizer' || v === 'admin' || v === 'staff';

const homeFor = (role: Role) => (role === 'staff' ? '/check-in' : '/events');

export const middleware = (req: NextRequest) => {
  const rawRole = req.cookies.get('session_role')?.value;
  const role = isRole(rawRole) ? rawRole : null;
  const hasRefresh = Boolean(req.cookies.get('session_refresh')?.value);
  const path = req.nextUrl.pathname;
  const forceReauth = req.nextUrl.searchParams.get('reauth') === '1';

  if (path === '/login' && forceReauth) {
    const res = NextResponse.next();
    const expiredAt = new Date(0);
    res.cookies.set('session_access', '', { expires: expiredAt, path: '/' });
    res.cookies.set('session_refresh', '', { expires: expiredAt, path: '/' });
    res.cookies.set('session_role', '', { expires: expiredAt, path: '/' });
    return res;
  }

  const authedRole = role && hasRefresh ? role : null;

  // Not authed: only /login and / are reachable.
  if (!authedRole) {
    if (path !== '/login' && path !== '/') {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    return NextResponse.next();
  }

  // Authed but hitting /login: send home.
  if (path === '/login' || path === '/') {
    return NextResponse.redirect(new URL(homeFor(authedRole), req.url));
  }

  // Staff cannot touch /events/* or /financeiro/*.
  if (authedRole === 'staff' && (path.startsWith('/events') || path.startsWith('/financeiro'))) {
    return NextResponse.redirect(new URL('/check-in', req.url));
  }

  return NextResponse.next();
};
