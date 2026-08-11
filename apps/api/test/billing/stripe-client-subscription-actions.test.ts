import { buildFakeStripe } from '../../src/services/stripe/fake.js';
import { describe, expect, it } from 'vitest';

describe('fake stripe: acoes de assinatura', () => {
  it('registra a troca de preco do item com a chave de idempotencia', async () => {
    const stripe = buildFakeStripe();
    await stripe.updateSubscriptionItemPrice({
      subscriptionItemId: 'si_plan_1',
      priceId: 'price_gold_monthly',
      idempotencyKey: 'plan_change_mem_1_gold_monthly',
    });
    expect(stripe.calls).toEqual([
      {
        kind: 'updateSubscriptionItemPrice',
        payload: {
          subscriptionItemId: 'si_plan_1',
          priceId: 'price_gold_monthly',
          idempotencyKey: 'plan_change_mem_1_gold_monthly',
        },
      },
    ]);
  });

  it('registra retomada de cancelamento, pausa e retomada de cobranca', async () => {
    const stripe = buildFakeStripe();
    await stripe.resumeSubscriptionCancellation({ subscriptionId: 'sub_1', idempotencyKey: 'a' });
    await stripe.pauseSubscriptionCollection({ subscriptionId: 'sub_1', idempotencyKey: 'b' });
    await stripe.resumeSubscriptionCollection({ subscriptionId: 'sub_1', idempotencyKey: 'c' });
    expect(stripe.calls.map((c) => c.kind)).toEqual([
      'resumeSubscriptionCancellation',
      'pauseSubscriptionCollection',
      'resumeSubscriptionCollection',
    ]);
  });

  it('propaga o erro injetado em cada acao', async () => {
    const stripe = buildFakeStripe();
    stripe.nextUpdateSubscriptionItemPriceError = new Error('stripe down');
    await expect(
      stripe.updateSubscriptionItemPrice({
        subscriptionItemId: 'si_1',
        priceId: 'price_1',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow('stripe down');

    stripe.nextPauseSubscriptionCollectionError = new Error('pause failed');
    await expect(
      stripe.pauseSubscriptionCollection({ subscriptionId: 'sub_1', idempotencyKey: 'k' }),
    ).rejects.toThrow('pause failed');
  });
});
