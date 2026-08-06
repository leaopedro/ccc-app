import { describe, expect, it } from 'vitest';

import { normalizeStripeEvent } from '../../src/services/billing/normalize-stripe.js';
import type { WebhookEvent } from '../../src/services/stripe/index.js';

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
  items: { data: [{ price: { id: 'price_gold', metadata: {} } }] },
};

describe('normalizeStripeEvent: pause_collection', () => {
  it('emite subscription.paused quando pause_collection aparece', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        pause_collection: { behavior: 'void' },
        previous_attributes: { pause_collection: null },
      }),
    );
    expect(result).toEqual({
      kind: 'subscription.paused',
      provider: 'stripe',
      providerSubRef: 'sub_1',
    });
  });

  it('emite subscription.resumed quando pause_collection volta a ser null', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        pause_collection: null,
        previous_attributes: { pause_collection: { behavior: 'void' } },
      }),
    );
    expect(result).toEqual({
      kind: 'subscription.resumed',
      provider: 'stripe',
      providerSubRef: 'sub_1',
    });
  });

  it('nao emite nada quando pause_collection nao muda', () => {
    expect(
      normalizeStripeEvent(
        subUpdated({ ...baseSub, pause_collection: null, previous_attributes: {} }),
      ),
    ).toBeNull();
  });

  it('flip de cancel_at_period_end tem prioridade sobre pause_collection', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        cancel_at_period_end: true,
        pause_collection: { behavior: 'void' },
        previous_attributes: { cancel_at_period_end: false, pause_collection: null },
      }),
    );
    expect(result).toMatchObject({ kind: 'subscription.cancelled' });
  });

  it('pause_collection tem prioridade sobre swap de preco', () => {
    const result = normalizeStripeEvent(
      subUpdated({
        ...baseSub,
        pause_collection: { behavior: 'void' },
        items: { data: [{ price: { id: 'price_silver', metadata: {} } }] },
        previous_attributes: {
          pause_collection: null,
          items: { data: [{ price: { id: 'price_gold' } }] },
        },
      }),
    );
    expect(result).toMatchObject({ kind: 'subscription.paused' });
  });
});
