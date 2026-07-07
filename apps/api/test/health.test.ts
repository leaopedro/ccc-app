import { healthResponseSchema } from '@jdm/shared/health';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

const SHA_KEYS = ['GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA'] as const;

const snapshotShaEnv = () => {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of SHA_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
};

const restoreShaEnv = (snapshot: Record<string, string | undefined>) => {
  for (const key of SHA_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

describe('GET /health', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotShaEnv();
  });

  afterEach(() => {
    restoreShaEnv(envSnapshot);
  });

  it('returns ok and a valid payload', async () => {
    const app = await buildApp(loadEnv());
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const parsed = healthResponseSchema.parse(response.json());
      expect(parsed.status).toBe('ok');
      expect(response.headers['x-request-id']).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('uses RAILWAY_GIT_COMMIT_SHA when GIT_SHA is empty', async () => {
    process.env.GIT_SHA = '';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'abc123railway';
    const app = await buildApp(loadEnv());
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const parsed = healthResponseSchema.parse(response.json());
      expect(parsed.sha).toBe('abc123railway');
    } finally {
      await app.close();
    }
  });

  it('prefers GIT_SHA over RAILWAY_GIT_COMMIT_SHA when both are set', async () => {
    process.env.GIT_SHA = 'explicit-sha';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'railway-sha';
    const app = await buildApp(loadEnv());
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const parsed = healthResponseSchema.parse(response.json());
      expect(parsed.sha).toBe('explicit-sha');
    } finally {
      await app.close();
    }
  });

  it('falls back to "dev" when both GIT_SHA and RAILWAY_GIT_COMMIT_SHA are empty', async () => {
    process.env.GIT_SHA = '';
    process.env.RAILWAY_GIT_COMMIT_SHA = '';
    const app = await buildApp(loadEnv());
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const parsed = healthResponseSchema.parse(response.json());
      expect(parsed.sha).toBe('dev');
    } finally {
      await app.close();
    }
  });

  it('assigns a request id per request', async () => {
    const app = await buildApp(loadEnv());
    try {
      const a = await app.inject({ method: 'GET', url: '/health' });
      const b = await app.inject({ method: 'GET', url: '/health' });
      expect(a.headers['x-request-id']).not.toEqual(b.headers['x-request-id']);
    } finally {
      await app.close();
    }
  });
});
