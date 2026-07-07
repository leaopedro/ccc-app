import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/env.js';

describe('env: F8 billing entries (chunk F8.01)', () => {
  const baseEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
    APP_WEB_BASE_URL: 'http://localhost:3000',
    MAIL_FROM: 'test@jdm.test',
    STRIPE_SECRET_KEY: 'sk_test_' + 'c'.repeat(32),
    STRIPE_WEBHOOK_SECRET: 'd'.repeat(32),
    TICKET_CODE_SECRET: 'e'.repeat(32),
    FIELD_ENCRYPTION_KEY: 'f'.repeat(64),
  } as NodeJS.ProcessEnv;

  it('GROWTH_PREMIUM_BILLING_ENABLED defaults to true when absent', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(true);
  });

  it('GROWTH_PREMIUM_BILLING_ENABLED parses "true" as true', () => {
    const env = loadEnv({ ...baseEnv, GROWTH_PREMIUM_BILLING_ENABLED: 'true' });
    expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(true);
  });

  it('GROWTH_PREMIUM_BILLING_ENABLED parses "false" as false', () => {
    const env = loadEnv({ ...baseEnv, GROWTH_PREMIUM_BILLING_ENABLED: 'false' });
    expect(env.GROWTH_PREMIUM_BILLING_ENABLED).toBe(false);
  });

  it('STRIPE_BILLING_WEBHOOK_SECRET is optional and absent by default', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.STRIPE_BILLING_WEBHOOK_SECRET).toBeUndefined();
  });

  it('STRIPE_BILLING_WEBHOOK_SECRET parses when provided', () => {
    const env = loadEnv({ ...baseEnv, STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test123' });
    expect(env.STRIPE_BILLING_WEBHOOK_SECRET).toBe('whsec_test123');
  });

  it('REVENUECAT_WEBHOOK_AUTH_HEADER is optional and absent by default', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.REVENUECAT_WEBHOOK_AUTH_HEADER).toBeUndefined();
  });

  it('REVENUECAT_WEBHOOK_AUTH_HEADER parses when provided', () => {
    const env = loadEnv({ ...baseEnv, REVENUECAT_WEBHOOK_AUTH_HEADER: 'Bearer rc_secret_xyz' });
    expect(env.REVENUECAT_WEBHOOK_AUTH_HEADER).toBe('Bearer rc_secret_xyz');
  });

  it('STRIPE_PRICE_PREMIUM_GOLD_MONTHLY and STRIPE_PRICE_PREMIUM_GOLD_ANNUAL parse as optional strings', () => {
    const env = loadEnv({
      ...baseEnv,
      STRIPE_PRICE_PREMIUM_GOLD_MONTHLY: 'price_1AbcTest',
      STRIPE_PRICE_PREMIUM_GOLD_ANNUAL: 'price_1XyzTest',
    });
    expect(env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY).toBe('price_1AbcTest');
    expect(env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL).toBe('price_1XyzTest');
  });

  it('STRIPE_PRICE_PREMIUM_GOLD_MONTHLY and ANNUAL default to undefined when absent', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.STRIPE_PRICE_PREMIUM_GOLD_MONTHLY).toBeUndefined();
    expect(env.STRIPE_PRICE_PREMIUM_GOLD_ANNUAL).toBeUndefined();
  });
});
