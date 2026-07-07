import type { AuthResponse } from '@jdm/shared/auth';
import { cookies } from 'next/headers';

const ACCESS_COOKIE = 'session_access';
const REFRESH_COOKIE = 'session_refresh';
const ROLE_COOKIE = 'session_role';

const isProd = process.env.NODE_ENV === 'production';
const expiredAt = new Date(0);

export const writeSession = async (res: AuthResponse): Promise<void> => {
  const jar = await cookies();
  const secure = isProd;
  jar.set(ACCESS_COOKIE, res.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
  jar.set(REFRESH_COOKIE, res.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
  jar.set(ROLE_COOKIE, res.user.role, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
  });
};

export const clearSession = async (): Promise<void> => {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, '', {
    expires: expiredAt,
    path: '/',
  });
  jar.set(REFRESH_COOKIE, '', {
    expires: expiredAt,
    path: '/',
  });
  jar.set(ROLE_COOKIE, '', {
    expires: expiredAt,
    path: '/',
  });
};

export const readRole = async (): Promise<string | null> => {
  const jar = await cookies();
  return jar.get(ROLE_COOKIE)?.value ?? null;
};
