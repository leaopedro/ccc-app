// Per-file setup. Assumes global-setup.ts has started the test DB and set DATABASE_URL.
import { beforeEach } from 'vitest';

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
// is unable) to restore it leaks that value into every later file (and,
// within a file, into every later test).
//
// This MUST be a beforeEach hook, not a bare top-level statement. setupFiles
// re-run once per test FILE, so a top-level delete only guarantees a clean
// baseline at the start of each file — a leaker inside a describe block
// (test A sets the flag in afterEach and forgets to restore it) would still
// poison test B in the SAME file, because setup.ts would not run again until
// the next file. Registering the delete as a beforeEach here makes it a root
// hook that Vitest runs before every test in every file — including before
// any beforeEach declared inside a test file's own describe block, since
// root hooks from setup files are registered (and therefore run) before the
// file's own hooks. That ordering is what lets files which deliberately set
// the flag in their own beforeEach (e.g. revenuecat-webhook.test.ts,
// publish-grant.test.ts) still win for their own tests: this hook clears the
// flag first, then the file's beforeEach sets it to whatever that file
// actually wants, immediately after. Do not replace this with a fixed
// 'true'/'false' assignment — deletion is what reproduces the unset-default
// behavior ("absent -> defaults true") tests rely on.
beforeEach(() => {
  delete process.env.GROWTH_PREMIUM_BILLING_ENABLED;
  // Same leak hazard as the flag above: vitest runs this suite in a single
  // fork, so a file that turns the gate on and forgets to restore it would
  // poison every later file. Clear here; files that want it set it in their
  // own beforeEach, which runs after this root hook.
  delete process.env.PROFILE_GATE_ENABLED;
  delete process.env.PROFILE_GATE_ROLLOUT_PERCENT;
});
