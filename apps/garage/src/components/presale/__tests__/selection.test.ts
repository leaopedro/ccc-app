import type { PresaleCampaign, PresaleProduct } from '@ccc/shared/presale';
import { describe, expect, it } from 'vitest';

import {
  buildCheckoutPayload,
  classifyTier,
  computeExpectedTotalCents,
  hasSizeOptions,
  isFulfillmentSupported,
  resolveCheckoutError,
  visibleFaqItems,
} from '../selection';

import { PresaleConflictError, PresaleInvalidRequestError } from '~/lib/presale-api';

const campaign: PresaleCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande São Paulo',
  pickupAddress: 'Pocket CASA, Rua Augusta 123',
  pickupHours: 'seg a sex, 9h às 18h',
  firstBatchLabel: '1º lote',
};

const basicProduct: PresaleProduct = {
  id: 'p-basic',
  slug: 'casa-in-box-basic',
  title: 'Casa In Box Basic',
  shortDescription: null,
  coverImageUrl: null,
  canShip: true,
  canPickup: true,
  variants: [
    {
      id: 'v-basic',
      title: 'Único',
      priceCents: 9900,
      currency: 'BRL',
      stockOnHand: 10,
      isActive: true,
    },
  ],
};

const premiumProduct: PresaleProduct = {
  id: 'p-premium',
  slug: 'casa-in-box-premium',
  title: 'Casa In Box Premium',
  shortDescription: null,
  coverImageUrl: null,
  canShip: true,
  canPickup: true,
  variants: [
    { id: 'v-p', title: 'P', priceCents: 15900, currency: 'BRL', stockOnHand: 5, isActive: true },
    { id: 'v-m', title: 'M', priceCents: 15900, currency: 'BRL', stockOnHand: 5, isActive: true },
    { id: 'v-g', title: 'G', priceCents: 15900, currency: 'BRL', stockOnHand: 5, isActive: true },
    { id: 'v-gg', title: 'GG', priceCents: 15900, currency: 'BRL', stockOnHand: 0, isActive: true },
  ],
};

describe('hasSizeOptions / classifyTier', () => {
  it('a single-variant product has no size options and classifies as basic', () => {
    expect(hasSizeOptions(basicProduct)).toBe(false);
    expect(classifyTier(basicProduct)).toBe('basic');
  });

  it('a multi-variant product has size options and classifies as premium', () => {
    expect(hasSizeOptions(premiumProduct)).toBe(true);
    expect(classifyTier(premiumProduct)).toBe('premium');
  });
});

describe('isFulfillmentSupported', () => {
  it('checks canPickup for pickup and canShip for ship', () => {
    const pickupOnly = { ...basicProduct, canShip: false, canPickup: true };
    const shipOnly = { ...basicProduct, canShip: true, canPickup: false };
    expect(isFulfillmentSupported(pickupOnly, 'pickup')).toBe(true);
    expect(isFulfillmentSupported(pickupOnly, 'ship')).toBe(false);
    expect(isFulfillmentSupported(shipOnly, 'ship')).toBe(true);
    expect(isFulfillmentSupported(shipOnly, 'pickup')).toBe(false);
  });
});

describe('computeExpectedTotalCents', () => {
  it('pickup charges just the variant price', () => {
    expect(computeExpectedTotalCents(9900, 'pickup', 1990)).toBe(9900);
  });

  it('ship adds the shipping fee once', () => {
    expect(computeExpectedTotalCents(9900, 'ship', 1990)).toBe(11890);
  });
});

describe('visibleFaqItems', () => {
  const items = [
    { question: 'Quando a caixa chega?', body: 'a', requiresField: 'firstBatchLabel' as const },
    { question: 'Posso retirar?', body: 'b', requiresField: 'pickupAddress' as const },
    {
      question: 'Entrega na minha região?',
      body: 'c',
      requiresField: 'deliveryAreaLabel' as const,
    },
    { question: 'Como funciona o pagamento?', body: 'd' },
  ];

  it('keeps items whose required campaign field is filled', () => {
    expect(visibleFaqItems(items, campaign).map((i) => i.question)).toEqual([
      'Quando a caixa chega?',
      'Posso retirar?',
      'Entrega na minha região?',
      'Como funciona o pagamento?',
    ]);
  });

  it('omits the pickup question when pickupAddress is null', () => {
    const noPickup: PresaleCampaign = { ...campaign, pickupAddress: null };
    const visible = visibleFaqItems(items, noPickup).map((i) => i.question);
    expect(visible).not.toContain('Posso retirar?');
    expect(visible).toContain('Como funciona o pagamento?');
  });

  it('always keeps items with no requiresField', () => {
    const emptyCampaign: PresaleCampaign = {
      enabled: true,
      shippingFeeCents: 0,
      deliveryAreaLabel: null,
      pickupAddress: null,
      pickupHours: null,
      firstBatchLabel: null,
    };
    expect(visibleFaqItems(items, emptyCampaign).map((i) => i.question)).toEqual([
      'Como funciona o pagamento?',
    ]);
  });
});

describe('buildCheckoutPayload', () => {
  it('builds a single-line items array, never an object', () => {
    const payload = buildCheckoutPayload({
      variantId: 'v-basic',
      fulfillmentMethod: 'pickup',
      expectedTotalCents: 9900,
      guest: { name: 'Fulano', email: 'fulano@example.com' },
      acceptedTermsVersion: 'terms-2026-08-14',
      acceptedPrivacyVersion: 'privacy-2026-11-10',
    });
    expect(payload.items).toEqual([{ variantId: 'v-basic', quantity: 1 }]);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.delivery).toBeUndefined();
  });

  it('drops delivery when fulfillment is pickup even if a delivery object is passed in', () => {
    const payload = buildCheckoutPayload({
      variantId: 'v-basic',
      fulfillmentMethod: 'pickup',
      expectedTotalCents: 9900,
      guest: { name: 'Fulano', email: 'fulano@example.com' },
      delivery: {
        recipientName: 'Fulano',
        line1: 'Rua X',
        number: '1',
        district: 'Centro',
        city: 'São Paulo',
        stateCode: 'SP',
        postalCode: '01000-000',
      },
      acceptedTermsVersion: 'terms-2026-08-14',
      acceptedPrivacyVersion: 'privacy-2026-11-10',
    });
    expect(payload.delivery).toBeUndefined();
  });

  it('keeps delivery when fulfillment is ship', () => {
    const delivery = {
      recipientName: 'Fulano',
      line1: 'Rua X',
      number: '1',
      district: 'Centro',
      city: 'São Paulo',
      stateCode: 'SP' as const,
      postalCode: '01000-000',
    };
    const payload = buildCheckoutPayload({
      variantId: 'v-basic',
      fulfillmentMethod: 'ship',
      expectedTotalCents: 11890,
      guest: { name: 'Fulano', email: 'fulano@example.com' },
      delivery,
      acceptedTermsVersion: 'terms-2026-08-14',
      acceptedPrivacyVersion: 'privacy-2026-11-10',
    });
    expect(payload.delivery).toEqual(delivery);
  });
});

describe('resolveCheckoutError', () => {
  it('maps PresaleConflictError to the conflict copy', () => {
    const err = new PresaleConflictError('PRESALE_TOTAL_CHANGED', 'o valor mudou');
    const copy = resolveCheckoutError(err);
    expect(copy.title).toBe('O pedido mudou');
  });

  it('maps PresaleInvalidRequestError to the invalid copy, distinct from conflict', () => {
    const err = new PresaleInvalidRequestError('PRESALE_QUANTITY_TOO_HIGH', 'dados inválidos');
    const copy = resolveCheckoutError(err);
    expect(copy.title).toBe('Dados inválidos');
    expect(copy.title).not.toBe(resolveCheckoutError(new PresaleConflictError('X', 'y')).title);
  });

  it('maps anything else to the generic copy', () => {
    const copy = resolveCheckoutError(new Error('network down'));
    expect(copy.title).toBe('Não foi possível concluir');
  });
});
