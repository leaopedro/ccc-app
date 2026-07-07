import { scrubSentryEvent } from '@jdm/shared/sentry-scrubber';
import type { BrowserOptions } from '@sentry/nextjs';

// Legal basis: strict-necessary / legitimate-interest (LGPD Art. 7 II + IX,
// LIA-05, L15, L22).
//
// The admin app is a B2B back-office tool restricted to authenticated platform
// operators. It is not a consumer-facing product and does not present a
// cookie-consent surface to end users.
//
// Server and edge runtimes: strict-necessary (Art. 7, II). Operational error
// telemetry for platform integrity; no browser interaction involved.
//
// Client runtime: legitimate-interest (Art. 7, IX, LIA-05). T01 beforeSend
// scrubber (JDMA-637) strips emails, CPF patterns, cookies, request bodies,
// and non-safe headers before any event is transmitted, satisfying the data-
// minimization precondition for LI under L15.
//
// Session replay is NOT covered by this LI claim and is DISABLED (rates = 0).
// The LIA-05 pack (JDMA-661) requires a consent gate before replay can run.
// Re-enable only after a per-user consent record exists (see JDMA-664 T12).
//
// Kill switch: unset SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN in the environment.
// enabled=false prevents Sentry.init from connecting, even if the SDK loads.

const MAX_CRUMB_LEN = 200;
const PII_RE = /[^@\s]+@[^@\s]+\.[^@\s]+|\d{3}\.\d{3}\.\d{3}-\d{2}/;

// BrowserOptions is used here because @sentry/nextjs unified init() accepts it
// as a union member. skipLibCheck:true is project-wide; server/edge runtimes
// omit replay fields at runtime, which is what matters for correctness.
export function buildAdminSentryOptions(
  dsn: string | undefined,
  runtime: 'client' | 'server' | 'edge',
): BrowserOptions {
  return {
    dsn,
    enabled: !!dsn,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      const scrubbed = scrubSentryEvent(event);
      if (!scrubbed) return null;
      if (scrubbed.breadcrumbs) {
        scrubbed.breadcrumbs = scrubbed.breadcrumbs.filter((crumb) => {
          if (crumb.category !== 'console') return true;
          const msg = typeof crumb.message === 'string' ? crumb.message : '';
          if (msg.length > MAX_CRUMB_LEN || PII_RE.test(msg)) return false;
          const rawArgs: unknown = crumb.data?.['arguments'];
          if (Array.isArray(rawArgs) && rawArgs.length > 0) {
            const serialized = rawArgs
              .map((a) => {
                if (typeof a === 'string') return a;
                try {
                  return JSON.stringify(a);
                } catch {
                  return '[unserializable]';
                }
              })
              .join(' ');
            if (serialized.length > MAX_CRUMB_LEN || PII_RE.test(serialized)) return false;
          }
          return true;
        });
      }
      return scrubbed;
    },
    ...(runtime === 'client'
      ? {
          // Replay disabled: no consent gate exists yet (JDMA-664 T12).
          // Set replaysOnErrorSampleRate > 0 only after per-user consent is
          // recorded. See docs/legal/lia-pack.md § LIA-05 preconditions.
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
        }
      : {}),
    initialScope: {
      tags: { service: 'admin', runtime },
    },
  };
}
