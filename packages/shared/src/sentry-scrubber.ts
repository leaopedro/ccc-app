// ---------------------------------------------------------------------------
// Sentry PII scrubber — strips sensitive data from Sentry events before
// they leave the client.  Zero runtime deps; no Sentry SDK import needed.
// ---------------------------------------------------------------------------

/* ---- Minimal Sentry-compatible types ----------------------------------- */

export interface SentryEvent {
  request?: {
    url?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string> | string;
    data?: unknown;
    query_string?: unknown;
  };
  user?: {
    email?: string;
    [key: string]: unknown;
  };
  breadcrumbs?: Array<{
    message?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/* ---- Constants --------------------------------------------------------- */

const SAFE_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'content-length',
  'content-type',
  'host',
  'origin',
  'user-agent',
  'x-request-id',
]);

const MAX_BREADCRUMB_LENGTH = 200;

/* ---- Scrub helpers ----------------------------------------------------- */

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    if (SAFE_HEADERS.has(key.toLowerCase())) {
      out[key] = headers[key]!;
    }
  }
  return out;
}

function scrubBreadcrumbs(
  breadcrumbs: NonNullable<SentryEvent['breadcrumbs']>,
): NonNullable<SentryEvent['breadcrumbs']> {
  return breadcrumbs.map((bc) => {
    const clean = { ...bc };

    if (typeof clean.message === 'string' && clean.message.length > MAX_BREADCRUMB_LENGTH) {
      clean.message = clean.message.slice(0, MAX_BREADCRUMB_LENGTH) + '…[truncated]';
    }

    delete clean.data;
    return clean;
  });
}

/* ---- Main export ------------------------------------------------------- */

/**
 * Deep-scrub a Sentry event of PII. Returns a new object; the original is
 * never mutated.
 */
export function scrubSentryEvent<T>(event: T): T {
  // Structural clone to avoid mutating the caller's object.
  const e = JSON.parse(JSON.stringify(event)) as SentryEvent;

  // -- request -----------------------------------------------------------
  if (e.request) {
    delete e.request.cookies;
    delete e.request.data;
    delete e.request.query_string;

    if (e.request.url) {
      const qIdx = e.request.url.indexOf('?');
      if (qIdx !== -1) e.request.url = e.request.url.slice(0, qIdx);
    }

    if (e.request.headers) {
      e.request.headers = scrubHeaders(e.request.headers);
    }
  }

  // -- user --------------------------------------------------------------
  if (e.user) {
    delete e.user.email;
  }

  // -- breadcrumbs -------------------------------------------------------
  if (e.breadcrumbs) {
    e.breadcrumbs = scrubBreadcrumbs(e.breadcrumbs);
  }

  return e as unknown as T;
}
