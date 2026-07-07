import type { CartItem, CartTotals } from '@jdm/shared/cart';
import type { MyTicket } from '@jdm/shared/tickets';
import { describe, expect, it } from 'vitest';

import {
  buildCartSections,
  buildPickupEventOptions,
  collectCartTicketEventIds,
  computeDefaultFulfillmentMethod,
  computeDisplayedCartTotals,
  formatProductAttributes,
} from '../presentation';

const baseTotals: CartTotals = {
  ticketSubtotalCents: 0,
  extrasSubtotalCents: 0,
  productsSubtotalCents: 9000,
  shippingSubtotalCents: 1500,
  discountCents: 0,
  baseAmountCents: 9000,
  devFeePercent: 10,
  devFeeAmountCents: 900,
  amountCents: 11400,
  currency: 'BRL',
};

const baseItem = (overrides: Partial<CartItem>): CartItem => ({
  id: 'item_1',
  eventId: 'evt_1',
  tierId: 'tier_1',
  variantId: null,
  source: 'purchase',
  kind: 'ticket',
  quantity: 1,
  requiresCar: false,
  tickets: [{ extras: [] }],
  extras: [],
  product: null,
  amountCents: 15000,
  currency: 'BRL',
  reservationExpiresAt: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
  ...overrides,
});

describe('cart presentation helpers', () => {
  it('groups mixed carts into ticket and product sections', () => {
    const sections = buildCartSections([
      baseItem({ id: 'ticket_1' }),
      baseItem({
        id: 'product_1',
        eventId: null,
        tierId: null,
        variantId: 'var_1',
        kind: 'product',
        product: {
          productId: 'prod_1',
          productTitle: 'Camiseta JDM',
          productSlug: 'camiseta-jdm',
          variantId: 'var_1',
          variantName: 'Preto / G',
          variantSku: 'SKU-1',
          unitPriceCents: 9900,
          canShip: true,
          canPickup: false,
          shippingFeeCents: 2500,
          attributes: { Cor: 'Preto', Tamanho: 'G' },
        },
      }),
    ]);

    expect(sections).toEqual([
      { key: 'ticket', title: 'Ingressos', data: [expect.objectContaining({ id: 'ticket_1' })] },
      { key: 'product', title: 'Produtos', data: [expect.objectContaining({ id: 'product_1' })] },
    ]);
  });

  it('skips empty cart sections', () => {
    const sections = buildCartSections([baseItem({ id: 'ticket_1' })]);

    expect(sections).toEqual([
      { key: 'ticket', title: 'Ingressos', data: [expect.objectContaining({ id: 'ticket_1' })] },
    ]);
  });

  it('formats visible product attributes into a compact label', () => {
    expect(
      formatProductAttributes({
        Cor: 'Preto',
        Tamanho: 'G',
        Estoque: 5,
        Inativo: false,
        Ignorar: null,
        Nested: { foo: 'bar' },
      }),
    ).toBe('Cor: Preto · Tamanho: G · Estoque: 5 · Inativo: false');
  });

  it('collects unique event ids from ticket cart items only', () => {
    expect(
      collectCartTicketEventIds([
        baseItem({ id: 'ticket_1', eventId: 'evt_1' }),
        baseItem({ id: 'ticket_2', eventId: 'evt_1' }),
        baseItem({
          id: 'product_1',
          eventId: null,
          tierId: null,
          variantId: 'var_1',
          kind: 'product',
          product: {
            productId: 'prod_1',
            productTitle: 'Camiseta JDM',
            productSlug: 'camiseta-jdm',
            variantId: 'var_1',
            variantName: 'Preto / G',
            variantSku: 'SKU-1',
            unitPriceCents: 9900,
            canShip: false,
            canPickup: true,
            shippingFeeCents: null,
            attributes: null,
          },
        }),
      ]),
    ).toEqual(['evt_1']);
  });

  it('builds pickup options from owned tickets plus cart ticket events', () => {
    const ticket = {
      id: 'ticket_1',
      code: 'qr_1',
      status: 'valid',
      source: 'purchase',
      tierName: 'Geral',
      nickname: null,
      usedAt: null,
      createdAt: '2026-05-01T10:00:00.000Z',
      event: {
        id: 'evt_1',
        slug: 'evento-1',
        title: 'Evento 1',
        coverUrl: null,
        startsAt: '2026-05-10T10:00:00.000Z',
        endsAt: '2026-05-10T12:00:00.000Z',
        venueName: 'Autódromo',
        city: 'Curitiba',
        stateCode: 'PR',
        type: 'meeting',
        status: 'published',
      },
      extras: [],
      pickupOrders: [],
      pickupVouchers: [],
    } satisfies MyTicket;

    expect(
      buildPickupEventOptions(
        [ticket],
        [
          {
            id: 'evt_1',
            title: 'Evento 1',
            startsAt: '2026-05-10T10:00:00.000Z',
            endsAt: '2026-05-10T12:00:00.000Z',
          },
          {
            id: 'evt_2',
            title: 'Evento 2',
            startsAt: '2026-05-11T10:00:00.000Z',
            endsAt: '2026-05-11T12:00:00.000Z',
          },
        ],
      ),
    ).toEqual([
      {
        id: 'evt_1',
        title: 'Evento 1',
        startsAt: '2026-05-10T10:00:00.000Z',
        endsAt: '2026-05-10T12:00:00.000Z',
        hasOwnedTicket: true,
        hasCartTicket: true,
      },
      {
        id: 'evt_2',
        title: 'Evento 2',
        startsAt: '2026-05-11T10:00:00.000Z',
        endsAt: '2026-05-11T12:00:00.000Z',
        hasOwnedTicket: false,
        hasCartTicket: true,
      },
    ]);
  });

  it('skips owned tickets whose event has been cancelled', () => {
    const cancelledTicket = {
      id: 'ticket_cancelled',
      code: 'qr_cancelled',
      status: 'valid',
      source: 'purchase',
      tierName: 'Geral',
      nickname: null,
      usedAt: null,
      createdAt: '2026-05-01T10:00:00.000Z',
      event: {
        id: 'evt_cancelled',
        slug: 'cancelado',
        title: 'Cancelado',
        coverUrl: null,
        startsAt: '2026-05-10T10:00:00.000Z',
        endsAt: '2026-05-10T12:00:00.000Z',
        venueName: 'Autódromo',
        city: 'Curitiba',
        stateCode: 'PR',
        type: 'meeting',
        status: 'cancelled',
      },
      extras: [],
      pickupOrders: [],
      pickupVouchers: [],
    } satisfies MyTicket;

    expect(buildPickupEventOptions([cancelledTicket], [])).toEqual([]);
  });
});

describe('computeDisplayedCartTotals', () => {
  it('returns raw totals when method is ship', () => {
    expect(computeDisplayedCartTotals(baseTotals, 'ship')).toEqual(baseTotals);
  });

  it('returns raw totals when method is null', () => {
    expect(computeDisplayedCartTotals(baseTotals, null)).toEqual(baseTotals);
  });

  it('zeros shipping and adjusts amountCents when method is pickup', () => {
    expect(computeDisplayedCartTotals(baseTotals, 'pickup')).toEqual({
      ...baseTotals,
      shippingSubtotalCents: 0,
      amountCents: 9900,
    });
  });

  it('is a no-op when pickup but no shipping fee', () => {
    const noShipping: CartTotals = { ...baseTotals, shippingSubtotalCents: 0, amountCents: 9900 };
    expect(computeDisplayedCartTotals(noShipping, 'pickup')).toEqual(noShipping);
  });
});

describe('computeDefaultFulfillmentMethod', () => {
  it('returns null when no methods are available', () => {
    expect(
      computeDefaultFulfillmentMethod([], {
        cartHasTicket: false,
        userOwnsValidFutureTicket: false,
      }),
    ).toBeNull();
  });

  it('returns the only method when one is available', () => {
    expect(
      computeDefaultFulfillmentMethod(['ship'], {
        cartHasTicket: true,
        userOwnsValidFutureTicket: true,
      }),
    ).toBe('ship');
    expect(
      computeDefaultFulfillmentMethod(['pickup'], {
        cartHasTicket: false,
        userOwnsValidFutureTicket: false,
      }),
    ).toBe('pickup');
  });

  it('defaults to pickup when both available and user has cart ticket', () => {
    expect(
      computeDefaultFulfillmentMethod(['pickup', 'ship'], {
        cartHasTicket: true,
        userOwnsValidFutureTicket: false,
      }),
    ).toBe('pickup');
  });

  it('defaults to pickup when both available and user owns a valid future ticket', () => {
    expect(
      computeDefaultFulfillmentMethod(['pickup', 'ship'], {
        cartHasTicket: false,
        userOwnsValidFutureTicket: true,
      }),
    ).toBe('pickup');
  });

  it('falls back to ship when both available and no ticket signal', () => {
    expect(
      computeDefaultFulfillmentMethod(['pickup', 'ship'], {
        cartHasTicket: false,
        userOwnsValidFutureTicket: false,
      }),
    ).toBe('ship');
  });
});
