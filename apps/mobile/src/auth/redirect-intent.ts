// Public routes anonymous users can browse without auth.
// Protected routes redirect to /login with a sanitized `next` param.

const PUBLIC_EXACT = new Set<string>(['/', '/welcome', '/events']);
const EVENTS_DETAIL_RE = /^\/events\/[^/]+$/;
const STORE_PUBLIC_RE = /^\/store(?:\/[^/]+)?$/;

const NEXT_ALLOWED_PREFIXES = [
  '/welcome',
  '/events',
  '/store',
  '/cart',
  '/tickets',
  '/garage',
  '/profile',
  '/caixa',
];

// Post-signin landing per the per-user pivot spec §6.2 + §8: the app
// always lands on /garage, regardless of car count. /garage is also where
// the empty-state CTA "Adicione seu primeiro carro" lives.
export const DEFAULT_POST_AUTH = '/garage';

export const isPublicPath = (path: string): boolean => {
  if (PUBLIC_EXACT.has(path)) return true;
  if (EVENTS_DETAIL_RE.test(path)) return true;
  if (STORE_PUBLIC_RE.test(path)) return true;
  return false;
};

export const sanitizeNext = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  if (raw.includes('://')) return null;
  if (raw.includes('\n') || raw.includes('\r') || raw.includes('\t')) return null;
  const path = raw.split('?')[0]?.split('#')[0] ?? '';
  if (path.length === 0) return null;
  const matches = NEXT_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return matches ? raw : null;
};

export const buildLoginHref = (next: string | null | undefined): string => {
  const safe = sanitizeNext(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
};

export const buildSignupHref = (next: string | null | undefined): string => {
  const safe = sanitizeNext(next);
  return safe ? `/signup?next=${encodeURIComponent(safe)}` : '/signup';
};
