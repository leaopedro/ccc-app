import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/env.js';
import { runVendorFanout } from '../../src/services/account-deletion/vendor-fanout.js';
import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { createUser, resetDatabase } from '../helpers.js';

const env = loadEnv();

describe('vendor fanout — AbacatePay', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // AbacatePay is a NAMED Operador in the published privacy policy
  // (packages/shared/src/legal.ts, subprocessor table). A named processor that
  // never appears in the deletion log is an LGPD gap: we cannot state what
  // happened to the data subject's records there.
  it('emits a step for AbacatePay', async () => {
    const { user } = await createUser({ email: 'abacate@jdm.test', verified: true });
    const steps = await runVendorFanout(user.id, buildFakeStripe(), env);

    const step = steps.find((s) => s.step === 'abacatepay_customer_delete');
    expect(step).toBeDefined();
    expect(step?.status).toBe('skipped');
    expect(step?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps every pre-existing vendor step', async () => {
    const { user } = await createUser({ email: 'abacate2@jdm.test', verified: true });
    const steps = await runVendorFanout(user.id, buildFakeStripe(), env);
    const names = steps.map((s) => s.step);

    expect(names).toContain('stripe_customer_delete');
    expect(names).toContain('expo_token_cleanup');
    expect(names).toContain('sentry_user_delete');
    expect(names).toContain('resend_contact_remove');
    expect(names).toContain('abacatepay_customer_delete');
  });
});
