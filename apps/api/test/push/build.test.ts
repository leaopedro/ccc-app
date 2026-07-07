import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { DevPushSender } from '../../src/services/push/dev.js';
import { ExpoPushSender } from '../../src/services/push/expo.js';
import { buildPushSender } from '../../src/services/push/index.js';

const baseEnv = {
  DATABASE_URL: 'postgres://test/test',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
  APP_WEB_BASE_URL: 'http://localhost:3000',
  MAIL_FROM: 'noreply@jdm.test',
  STRIPE_SECRET_KEY: 'test_stripe_secret_key_minimum_32_chars_xx',
  STRIPE_WEBHOOK_SECRET: 'test_stripe_webhook_secret_32_chars_min_xx',
  TICKET_CODE_SECRET: 'test_ticket_code_secret_32_chars_min_xx',
  FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
};

describe('buildPushSender', () => {
  it('returns DevPushSender for NODE_ENV=development with default PUSH_PROVIDER', () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: 'development' });
    expect(buildPushSender(env)).toBeInstanceOf(DevPushSender);
  });

  it('returns ExpoPushSender for NODE_ENV=production with default PUSH_PROVIDER', () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: 'production' });
    expect(buildPushSender(env)).toBeInstanceOf(ExpoPushSender);
  });

  it('forces ExpoPushSender in development when PUSH_PROVIDER=expo', () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: 'development', PUSH_PROVIDER: 'expo' });
    expect(buildPushSender(env)).toBeInstanceOf(ExpoPushSender);
  });

  it('forces DevPushSender in production when PUSH_PROVIDER=dev', () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: 'production', PUSH_PROVIDER: 'dev' });
    expect(buildPushSender(env)).toBeInstanceOf(DevPushSender);
  });
});
