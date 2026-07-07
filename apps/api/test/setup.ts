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
