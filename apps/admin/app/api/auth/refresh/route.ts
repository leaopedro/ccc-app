import { authResponseSchema } from '@jdm/shared/auth';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { clearSession, writeSession } from '~/lib/auth-session';

const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get('session_refresh')?.value;
  if (!refreshToken) {
    await clearSession();
    return NextResponse.json({ error: 'no_refresh_token' }, { status: 401 });
  }

  const res = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) {
    await clearSession();
    return NextResponse.json({ error: 'refresh_failed' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = authResponseSchema.parse(await res.json());
  } catch {
    await clearSession();
    return NextResponse.json({ error: 'parse_failed' }, { status: 500 });
  }

  await writeSession(parsed);
  return NextResponse.json({ accessToken: parsed.accessToken });
}
