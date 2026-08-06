import { describe, expect, it } from 'vitest';

import type { Env } from '../../src/env.js';
import { buildLoggerOptions, stripSensitiveQueryParams } from '../../src/logger.js';

describe('stripSensitiveQueryParams', () => {
  it('strips webhookSecret from URL', () => {
    const result = stripSensitiveQueryParams('/webhooks/abacatepay?webhookSecret=s3cret');
    expect(result).toBe('/webhooks/abacatepay');
  });

  it('preserves other query params', () => {
    const result = stripSensitiveQueryParams('/webhooks/abacatepay?webhookSecret=s3cret&foo=bar');
    expect(result).toBe('/webhooks/abacatepay?foo=bar');
  });

  it('returns URL unchanged when no sensitive params', () => {
    const result = stripSensitiveQueryParams('/api/health?check=true');
    expect(result).toBe('/api/health?check=true');
  });
});

describe('buildLoggerOptions redaction', () => {
  const env = { LOG_LEVEL: 'info', GIT_SHA: 'test', NODE_ENV: 'test' } as unknown as Env;

  it('redacts the client IP (remoteAddress/remotePort)', () => {
    const opts = buildLoggerOptions(env);
    const paths = (opts.redact as { paths: string[] }).paths;
    expect(paths).toContain('req.remoteAddress');
    expect(paths).toContain('req.remotePort');
  });
});
