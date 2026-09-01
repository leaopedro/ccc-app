import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeApp } from './helpers.js';

/**
 * The three webhook paths are load-bearing OUTSIDE this repo.
 *
 * They are typed by hand into three provider dashboards, and Sentry alert rule
 * 2 (docs/observability.md) matches on the transaction name, which is the path.
 * Renaming a route here silently deletes an alert there, and silently 404s a
 * provider that will keep retrying for three days and then give up.
 *
 * The AbacatePay one also authenticates by query-string secret, not header
 * (routes/abacatepay-webhook.ts). Registering the URL without
 * `?webhookSecret=<value>` makes every delivery 401.
 *
 * This asserts with `app.hasRoute()`, which matches the exact registered
 * path, rather than scanning `app.printRoutes()` text with `toContain`.
 * `printRoutes` prints each route's segment inside a prefix-compressed tree,
 * so `toContain('/stripe/webhook')` also matches an accidental rename to
 * `/stripe/webhook-x` (the substring is still there) — verified against this
 * Fastify version by actually renaming the route and watching `toContain`
 * keep passing. `hasRoute` does an exact method+path lookup and has no such
 * false-negative failure mode.
 */
const EXPECTED_WEBHOOK_ROUTES = [
  { method: 'POST', url: '/stripe/webhook' },
  { method: 'POST', url: '/webhooks/stripe-billing' },
  { method: 'POST', url: '/abacatepay/webhook' },
] as const;

describe('webhook route paths', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers exactly the three paths the dashboards and the Sentry rule name', () => {
    for (const route of EXPECTED_WEBHOOK_ROUTES) {
      expect(app.hasRoute(route), `missing webhook route ${route.method} ${route.url}`).toBe(true);
    }
  });

  it('none of the three sits behind a prefix', () => {
    expect(app.hasRoute({ method: 'POST', url: '/api/stripe/webhook' })).toBe(false);
    expect(app.hasRoute({ method: 'POST', url: '/admin/stripe/webhook' })).toBe(false);
  });
});
