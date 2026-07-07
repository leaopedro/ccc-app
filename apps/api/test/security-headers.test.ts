import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeApp } from './helpers.js';

describe('security response headers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const expectedHeaders: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-xss-protection': '0',
    'x-dns-prefetch-control': 'off',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  };

  it('emits all security headers on GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(res.headers[header]).toBe(value);
    }
  });

  it('emits security headers on non-existent routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    for (const [header, value] of Object.entries(expectedHeaders)) {
      expect(res.headers[header]).toBe(value);
    }
  });
});
