import Stripe from 'stripe';
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

describe('constructWebhookEvent — envelope fidelity', () => {
  const SECRET = 'whsec_test_secret_for_envelope_fidelity';

  const signedEvent = (body: Record<string, unknown>) => {
    const payload = JSON.stringify(body);
    const signer = new Stripe('sk_test_dummy_key_at_least_32_chars_long');
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return { payload: Buffer.from(payload), header };
  };

  const subject = () =>
    buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_dummy_key_at_least_32_chars_long',
      STRIPE_WEBHOOK_SECRET: SECRET,
    });

  it('carries previous_attributes through from the Stripe envelope', async () => {
    // Regression pin: previous_attributes is a sibling of data.object. When the
    // seam dropped it, every customer.subscription.updated discriminator went
    // dead — cancel, uncancel, pause, resume and tier change all normalized to
    // null while Stripe considered the event delivered.
    const { payload, header } = signedEvent({
      id: 'evt_envelope_001',
      type: 'customer.subscription.updated',
      data: {
        object: { id: 'sub_1', cancel_at_period_end: true },
        previous_attributes: { cancel_at_period_end: false },
      },
    });

    const event = await subject().constructWebhookEvent(payload, header);

    expect(event.id).toBe('evt_envelope_001');
    expect(event.data.previous_attributes).toEqual({ cancel_at_period_end: false });
  });

  it('omits previous_attributes when Stripe does not send it', async () => {
    const { payload, header } = signedEvent({
      id: 'evt_envelope_002',
      type: 'invoice.paid',
      data: { object: { id: 'in_1' } },
    });

    const event = await subject().constructWebhookEvent(payload, header);

    expect(event.data.previous_attributes).toBeUndefined();
    expect(event.data.object).toEqual({ id: 'in_1' });
  });
});
