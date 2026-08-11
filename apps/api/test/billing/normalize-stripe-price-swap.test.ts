import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../src/services/billing/normalize-stripe.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';

/**
 * Fix round 2, finding 1: the price-swap discriminator on
 * customer.subscription.updated used to compare items.data[0] on the way in
 * (index-based), while plan-item.ts on the way out correctly refuses to
 * guess by position. With an add-on item on the subscription, Stripe does
 * not contractually order items.data — if the add-on happens to sit at
 * index 0 in both the previous and current item arrays, the old code
 * compared the add-on price against itself, missed the real plan swap
 * underneath, and returned null. These tests drive the fix: compare the
 * FULL SET of price ids, not index 0.
 */

const subUpdated = (object: Record<string, unknown>): WebhookEvent =>
  ({
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: { object },
  }) as unknown as WebhookEvent;

const baseSub = {
  id: 'sub_1',
  customer: 'cus_1',
  cancel_at_period_end: false,
  current_period_start: 1_700_000_000,
  current_period_end: 1_702_000_000,
  canceled_at: null,
  pause_collection: null,
};

const priceAddon = { id: 'price_addon', metadata: {} };
const priceGold = { id: 'price_gold', metadata: { devFeePercent: '10' } };
const priceSilver = {
  id: 'price_silver',
  metadata: { devFeePercent: '5' },
  recurring: { interval: 'month' },
};

describe('normalizeStripeEvent: price swap discriminator (set comparison)', () => {
  it('emite tier_changed com o novo preco do plano quando o add-on ocupa o indice 0 nos dois arrays (o bug)', () => {
    // Add-on first in BOTH arrays — the exact scenario that fooled the old
    // index-0-vs-index-0 comparison.
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceAddon }, { price: priceSilver }] },
        previous_attributes: {
          items: { data: [{ price: priceAddon }, { price: priceGold }] },
        },
      }),
    );

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.kind).toBe('subscription.tier_changed');
    if (result.kind !== 'subscription.tier_changed') return;
    expect(result.priceRef).toBe('price_silver');
    expect(result.priceMetadata).toEqual({ devFeePercent: '5' });
    expect(result.cadence).toBe('monthly');
  });

  it('emite tier_changed quando o plano ocupa o indice 0 nos dois arrays', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceSilver }, { price: priceAddon }] },
        previous_attributes: {
          items: { data: [{ price: priceGold }, { price: priceAddon }] },
        },
      }),
    );

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.kind).toBe('subscription.tier_changed');
    if (result.kind !== 'subscription.tier_changed') return;
    expect(result.priceRef).toBe('price_silver');
  });

  it('emite tier_changed com item unico (sem add-on)', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceSilver }] },
        previous_attributes: {
          items: { data: [{ price: priceGold }] },
        },
      }),
    );

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.kind).toBe('subscription.tier_changed');
    if (result.kind !== 'subscription.tier_changed') return;
    expect(result.priceRef).toBe('price_silver');
  });

  it('nao emite tier_changed quando um add-on e apenas anexado (plano inalterado)', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceGold }, { price: priceAddon }] },
        previous_attributes: {
          items: { data: [{ price: priceGold }] },
        },
      }),
    );

    expect(result).toBeNull();
  });

  it('nao emite tier_changed quando um add-on e apenas removido (plano inalterado)', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceGold }] },
        previous_attributes: {
          items: { data: [{ price: priceGold }, { price: priceAddon }] },
        },
      }),
    );

    expect(result).toBeNull();
  });

  it('nao emite nada quando os itens nao mudam', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceGold }, { price: priceAddon }] },
        previous_attributes: {
          items: { data: [{ price: priceGold }, { price: priceAddon }] },
        },
      }),
    );

    expect(result).toBeNull();
  });

  it('nao emite nada e nao lanca quando previous_attributes.items esta ausente', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        items: { data: [{ price: priceGold }] },
        previous_attributes: {},
      }),
    );

    expect(result).toBeNull();
  });
});
