import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { buildStripe } from '../../src/services/stripe/index.js';

const webhookSecret = 'whsec_test_secret_32_chars_minimum_xx';

const signPayload = (payload: string): string => {
  const stripe = new Stripe('sk_test_12345678901234567890123456789012', {
    apiVersion: '2026-04-22.dahlia',
  });
  return stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
};

describe('stripe service webhook parsing', () => {
  it('handles v2 event destination ping notifications', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_ping_1',
      object: 'v2.core.event',
      type: 'v2.core.event_destination.ping',
      livemode: false,
      created: '2026-05-04T01:52:05.825Z',
      related_object: {
        id: 'ed_test_1',
        type: 'v2.core.event_destination',
        url: '/v2/core/event_destinations/ed_test_1',
      },
      reason: {
        type: 'request',
        request: {
          id: 'req_1',
          idempotency_key: 'af3ac7bd-54c5-39a0-a6e3-158b5368ceea',
        },
      },
    });

    const client = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_12345678901234567890123456789012',
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    });

    const event = await client.constructWebhookEvent(Buffer.from(payload), signPayload(payload));

    expect(event.id).toBe('evt_test_ping_1');
    expect(event.type).toBe('v2.core.event_destination.ping');
    expect(event.data.object).toMatchObject({ id: 'evt_test_ping_1', object: 'v2.core.event' });
  });

  it('keeps v1 webhook payload parsing behavior', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_v1_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_1',
          metadata: { orderId: 'ord_1' },
        },
      },
    });

    const client = buildStripe({
      STRIPE_SECRET_KEY: 'sk_test_12345678901234567890123456789012',
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    });

    const event = await client.constructWebhookEvent(Buffer.from(payload), signPayload(payload));

    expect(event.id).toBe('evt_test_v1_1');
    expect(event.type).toBe('payment_intent.succeeded');
    expect(event.data.object).toMatchObject({ id: 'pi_test_1' });
  });
});
