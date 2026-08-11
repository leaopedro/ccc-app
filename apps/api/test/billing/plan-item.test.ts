import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { isBillingActionError } from '../../src/services/billing/errors.js';
import { resolvePlanSubscriptionItemId } from '../../src/services/billing/plan-item.js';

const sub = (items: Array<{ id: string; priceId: string }>): Stripe.Subscription =>
  ({
    id: 'sub_1',
    items: { data: items.map((i) => ({ id: i.id, price: { id: i.priceId } })) },
  }) as unknown as Stripe.Subscription;

const planPrices = new Set(['price_bronze', 'price_silver', 'price_gold']);

describe('resolvePlanSubscriptionItemId', () => {
  it('acha o item de plano quando ele e o unico', () => {
    expect(
      resolvePlanSubscriptionItemId({
        subscription: sub([{ id: 'si_1', priceId: 'price_gold' }]),
        planPriceIds: planPrices,
      }),
    ).toBe('si_1');
  });

  it('acha o item de plano mesmo quando modulos vem antes dele', () => {
    expect(
      resolvePlanSubscriptionItemId({
        subscription: sub([
          { id: 'si_addon_a', priceId: 'price_detailing' },
          { id: 'si_addon_b', priceId: 'price_oficina' },
          { id: 'si_plan', priceId: 'price_silver' },
        ]),
        planPriceIds: planPrices,
      }),
    ).toBe('si_plan');
  });

  it('lanca AmbiguousPlanItem quando nenhum item casa', () => {
    const err = (() => {
      try {
        resolvePlanSubscriptionItemId({
          subscription: sub([{ id: 'si_addon', priceId: 'price_detailing' }]),
          planPriceIds: planPrices,
        });
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isBillingActionError(err) && err.code).toBe('AmbiguousPlanItem');
  });

  it('lanca AmbiguousPlanItem quando dois itens casam', () => {
    const err = (() => {
      try {
        resolvePlanSubscriptionItemId({
          subscription: sub([
            { id: 'si_a', priceId: 'price_gold' },
            { id: 'si_b', priceId: 'price_silver' },
          ]),
          planPriceIds: planPrices,
        });
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(isBillingActionError(err) && err.code).toBe('AmbiguousPlanItem');
  });
});
