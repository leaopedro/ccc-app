import { describe, expect, it } from 'vitest';

import { stripSensitiveQueryParams } from '../../src/logger.js';

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
