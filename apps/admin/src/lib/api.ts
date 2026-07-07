import { healthResponseSchema, type HealthResponse } from '@jdm/shared/health';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ZodType } from 'zod';

const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type FetchOptions = RequestInit & { auth?: boolean };

// Refresh via the Next.js route handler so cookies can always be written,
// even when called from a Server Component (where direct cookie writes fail).
const refreshAccessToken = async (): Promise<string | null> => {
  const reqHeaders = await headers();
  const host = reqHeaders.get('host') ?? 'localhost:3000';
  const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const cookie = reqHeaders.get('cookie') ?? '';
  const res = await fetch(`${proto}://${host}/api/auth/refresh`, {
    method: 'POST',
    headers: { cookie },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  try {
    const { accessToken } = (await res.json()) as { accessToken: string };
    return accessToken ?? null;
  } catch {
    return null;
  }
};

export const apiFetch = async <T>(
  path: string,
  opts: FetchOptions & { schema: ZodType<T> },
): Promise<T> => {
  const { schema, auth = true, headers, ...rest } = opts;
  const jar = await cookies();
  const access = jar.get('session_access')?.value;
  const h = new Headers(headers);
  // Fastify rejects an empty body when content-type is application/json,
  // so only set it for requests that actually carry a body.
  if (rest.body) h.set('content-type', 'application/json');
  if (auth && access) h.set('authorization', `Bearer ${access}`);

  let res = await fetch(`${base}${path}`, { ...rest, headers: h, cache: 'no-store' });
  if (res.status === 401 && auth) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      h.set('authorization', `Bearer ${fresh}`);
      res = await fetch(`${base}${path}`, { ...rest, headers: h, cache: 'no-store' });
    } else {
      // Stale session: refresh failed. Send the user to login instead of crashing
      // the Server Component with an unhandled 401.
      redirect('/login?reauth=1');
    }
  }
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body.error ?? 'Error', body.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(json);
};

export const fetchHealth = async (): Promise<HealthResponse> =>
  apiFetch('/health', { schema: healthResponseSchema, auth: false });
