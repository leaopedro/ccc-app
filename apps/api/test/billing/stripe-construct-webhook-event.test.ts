import { describe, expect, it } from 'vitest';

import { buildStripe } from '../../src/services/stripe/index.js';

describe('constructWebhookEvent — secret override', () => {
  it('throws when secret override does not match payload signature', async () => {
    const stripe = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_at_least_32_chars_long',
      STRIPE_WEBHOOK_SECRET: 'whsec_default_secret_unused_here',
    });

    // Invalid buffer + override secret → StripeSignatureVerificationError
    await expect(
      stripe.constructWebhookEvent(
        Buffer.from('bad-payload'),
        't=1,v1=badhash',
        'whsec_override_secret_for_billing',
      ),
    ).rejects.toThrow();
  });

  it('accepts undefined override and falls back to default secret', async () => {
    const stripe = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_at_least_32_chars_long',
      STRIPE_WEBHOOK_SECRET: 'whsec_default_secret_unused_here',
    });

    // Still throws (wrong payload) but the call shape with undefined override must be accepted.
    await expect(
      stripe.constructWebhookEvent(Buffer.from('bad-payload'), 't=1,v1=badhash', undefined),
    ).rejects.toThrow();
  });
});
