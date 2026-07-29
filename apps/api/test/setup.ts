// Per-file setup. Assumes global-setup.ts has started the test DB and set DATABASE_URL.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GIT_SHA = 'test';
process.env.CORS_ORIGINS = '';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.REFRESH_TOKEN_PEPPER = 'b'.repeat(48);
process.env.APP_WEB_BASE_URL = 'http://localhost:3000';
process.env.MAIL_FROM = 'noreply@jdm.test';
process.env.STRIPE_SECRET_KEY = 'test_stripe_secret_key_minimum_32_chars_xx';
process.env.STRIPE_WEBHOOK_SECRET = 'test_stripe_webhook_secret_32_chars_min_xx';
process.env.TICKET_CODE_SECRET = 'test_ticket_code_secret_32_chars_min_xx';
process.env.FIELD_ENCRYPTION_KEY = 'ab'.repeat(32);
process.env.MFA_ENCRYPTION_KEY = 'test-mfa-encryption-key-32chars!!';

// vitest.config.ts runs this suite with pool 'forks' + singleFork: true, so
// every test file shares one process.env. GROWTH_PREMIUM_BILLING_ENABLED is
// mutated directly by several billing test files, and env.ts defaults it to
// true only when the var is ABSENT — so a file that sets it and forgets (or
// is unable) to restore it leaks that value into every later file. Deleting
// it here, before each test file's module graph loads, re-establishes the
// "fresh process" baseline (flag absent -> defaults true) regardless of what
// any prior file in this run left behind. Do not replace this with a fixed
// 'true'/'false' assignment — deletion is what reproduces the unset-default
// behavior tests rely on.
delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
