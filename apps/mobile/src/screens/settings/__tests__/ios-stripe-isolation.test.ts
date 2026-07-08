// ios-stripe-isolation.test.ts
//
// Verifies the `ccc-mobile/no-stripe-on-ios` ESLint rule fires on a fixture
// file containing a forbidden Stripe token outside an Android guard.
// Uses Node child_process to spawn ESLint and parse its JSON output — no
// jsdom needed.

import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// vitest runs with cwd = apps/mobile (the workspace root). Fixtures must live
// inside src/ so the flat-config `files: ['src/**/*.ts(x)']` glob picks them up;
// eslint refuses to lint files outside the config base path.
const MOBILE_ROOT = process.cwd();
const FIXTURE_ROOT_REL = 'src/.lint-fixtures';
const FIXTURE_ROOT = join(MOBILE_ROOT, FIXTURE_ROOT_REL);

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = join(
    FIXTURE_ROOT,
    `f8-lint-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(fixtureDir, { recursive: true });
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

const runEslint = (fixtureFile: string): string => {
  try {
    return execSync(`pnpm exec eslint --format json "${fixtureFile}"`, {
      cwd: MOBILE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e: unknown) {
    return (e as { stdout?: string }).stdout ?? '';
  }
};

describe('no-stripe-on-ios ESLint rule', () => {
  it('reports an error when stripe:// appears outside a Platform.OS guard', () => {
    const fixtureFile = join(fixtureDir, 'bad-fixture.tsx');
    writeFileSync(
      fixtureFile,
      `
// fixture: forbidden Stripe token outside any guard
const url = 'stripe://payment';
export default function BadComponent() { return null; }
`,
    );

    const output = runEslint(fixtureFile);
    const results = JSON.parse(output) as Array<{
      filePath: string;
      messages: Array<{ ruleId: string; message: string }>;
    }>;
    const messages = results.flatMap((r) => r.messages);
    const ruleHit = messages.some((m) => m.ruleId === 'ccc-mobile/no-stripe-on-ios');
    expect(ruleHit).toBe(true);
  });

  it('does NOT report an error when a Stripe token is guarded by Platform.OS !== "ios"', () => {
    const fixtureFile = join(fixtureDir, 'ok-fixture.tsx');
    writeFileSync(
      fixtureFile,
      `
import { Platform } from 'react-native';
// Android-only guard: rule must NOT fire here.
const url = Platform.OS !== 'ios' ? 'checkout.stripe.com/pay/session_1' : null;
export default function OkComponent() { return null; }
`,
    );

    const output = runEslint(fixtureFile);
    const results = JSON.parse(output) as Array<{
      messages: Array<{ ruleId: string }>;
    }>;
    const messages = results.flatMap((r) => r.messages);
    const ruleHit = messages.some((m) => m.ruleId === 'ccc-mobile/no-stripe-on-ios');
    expect(ruleHit).toBe(false);
  });

  it('reports an error when EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY appears without a guard', () => {
    const fixtureFile = join(fixtureDir, 'bad-env-fixture.tsx');
    writeFileSync(
      fixtureFile,
      `
const key = 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY';
export default function BadEnvComponent() { return null; }
`,
    );

    const output = runEslint(fixtureFile);
    const results = JSON.parse(output) as Array<{
      messages: Array<{ ruleId: string }>;
    }>;
    const messages = results.flatMap((r) => r.messages);
    const ruleHit = messages.some((m) => m.ruleId === 'ccc-mobile/no-stripe-on-ios');
    expect(ruleHit).toBe(true);
  });
});
