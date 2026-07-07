import { describe, expect, it } from 'vitest';

import {
  adminStoreFulfillmentUpdateSchema,
  mixedOrderRequestSchema,
  shippingAddressInputSchema,
  shippingAddressRecordSchema,
  shippingAddressSchema,
  shippingAddressUpdateSchema,
  storeProductListQuerySchema,
  storeProductSchema,
} from '../src/store.js';

describe('shippingAddressSchema', () => {
  it('accepts a valid brazilian shipping address', () => {
    expect(() =>
      shippingAddressSchema.parse({
        recipientName: 'Pedro Alves',
        phone: '41999998888',
        postalCode: '80000-000',
        street: 'Rua das Oficinas',
        number: '245',
        neighborhood: 'Centro',
        city: 'Curitiba',
        stateCode: 'PR',
      }),
    ).not.toThrow();
  });

  it('rejects invalid CEP format', () => {
    expect(() =>
      shippingAddressSchema.parse({
        recipientName: 'Pedro Alves',
        phone: '41999998888',
        postalCode: '8000-000',
        street: 'Rua das Oficinas',
        number: '245',
        neighborhood: 'Centro',
        city: 'Curitiba',
        stateCode: 'PR',
      }),
    ).toThrow();
  });
});

describe('shippingAddressInputSchema', () => {
  it('accepts isDefault flag', () => {
    const parsed = shippingAddressInputSchema.parse({
      recipientName: 'Pedro Alves',
      phone: '41999998888',
      postalCode: '80000-000',
      street: 'Rua das Oficinas',
      number: '245',
      neighborhood: 'Centro',
      city: 'Curitiba',
      stateCode: 'PR',
      isDefault: true,
    });
    expect(parsed.isDefault).toBe(true);
  });
});

describe('shippingAddressUpdateSchema', () => {
  it('allows partial payloads', () => {
    expect(() => shippingAddressUpdateSchema.parse({ isDefault: true })).not.toThrow();
    expect(() => shippingAddressUpdateSchema.parse({ city: 'Curitiba' })).not.toThrow();
  });
});

describe('shippingAddressRecordSchema', () => {
  it('parses a stored shipping address record', () => {
    expect(() =>
      shippingAddressRecordSchema.parse({
        id: 'addr_1',
        recipientName: 'Pedro Alves',
        phone: '41999998888',
        postalCode: '80000-000',
        street: 'Rua das Oficinas',
        number: '245',
        neighborhood: 'Centro',
        city: 'Curitiba',
        stateCode: 'PR',
        countryCode: 'BR',
        isDefault: true,
        createdAt: '2026-05-07T12:00:00.000Z',
        updatedAt: '2026-05-07T12:00:00.000Z',
      }),
    ).not.toThrow();
  });
});

describe('storeProductListQuerySchema', () => {
  it('coerces numeric limit and keeps default sort', () => {
    const parsed = storeProductListQuerySchema.parse({ limit: '12', q: ' camiseta ' });
    expect(parsed.limit).toBe(12);
    expect(parsed.sort).toBe('featured');
    expect(parsed.q).toBe('camiseta');
  });

  it('parses false boolean query params correctly', () => {
    const parsed = storeProductListQuerySchema.parse({ inStock: 'false' });
    expect(parsed.inStock).toBe(false);
  });
});

describe('mixedOrderRequestSchema', () => {
  it('requires a shipping address when store items exist', () => {
    expect(() =>
      mixedOrderRequestSchema.parse({
        paymentMethod: 'card',
        storeItems: [{ productId: 'prod_1', variantId: 'var_1', quantity: 2 }],
      }),
    ).toThrow(/endereço de entrega/i);
  });

  it('accepts mixed ticket and store payloads', () => {
    expect(() =>
      mixedOrderRequestSchema.parse({
        paymentMethod: 'card',
        tickets: [{ extras: [], nickname: 'Gol GTI' }],
        storeItems: [{ productId: 'prod_1', variantId: 'var_1', quantity: 1 }],
        shippingAddress: {
          recipientName: 'Pedro Alves',
          phone: '41999998888',
          postalCode: '80000000',
          street: 'Rua das Oficinas',
          number: '245',
          neighborhood: 'Centro',
          city: 'Curitiba',
          stateCode: 'PR',
        },
      }),
    ).not.toThrow();
  });
});

describe('adminStoreFulfillmentUpdateSchema', () => {
  it('requires tracking code when status is shipped', () => {
    expect(() => adminStoreFulfillmentUpdateSchema.parse({ status: 'shipped' })).toThrow(
      /trackingCode/i,
    );
  });

  it('accepts shipped payload with tracking data', () => {
    expect(() =>
      adminStoreFulfillmentUpdateSchema.parse({
        status: 'shipped',
        trackingCode: 'BR123456789',
        note: 'Enviado pelos Correios.',
      }),
    ).not.toThrow();
  });

  it('rejects unknown fields outside the approved contract', () => {
    expect(() =>
      adminStoreFulfillmentUpdateSchema.parse({
        status: 'shipped',
        trackingCode: 'BR123456789',
        trackingUrl: 'https://rastreamento.example.com/BR123456789',
      }),
    ).toThrow();
  });
});

describe('storeProductSchema', () => {
  it('accepts a product with variants and collections', () => {
    expect(() =>
      storeProductSchema.parse({
        id: 'prod_1',
        slug: 'camiseta-jdm-preta',
        title: 'Camiseta JDM Preta',
        description: 'Algodão pesado com estampa frontal.',
        shortDescription: 'Camiseta oficial JDM.',
        status: 'active',
        canShip: true,
        canPickup: false,
        coverImageUrl: 'https://cdn.jdm.app/store/camiseta.jpg',
        collectionIds: ['col_1'],
        productType: {
          id: 'type_1',
          slug: 'camisetas',
          name: 'Camisetas',
          description: null,
        },
        variants: [
          {
            id: 'var_1',
            sku: 'TSHIRT-PRETA-M',
            title: 'Preta / M',
            priceCents: 8990,
            displayPriceCents: 9889,
            devFeePercent: 10,
            compareAtPriceCents: null,
            currency: 'BRL',
            stockOnHand: 8,
            isActive: true,
            capacityDisplay: {
              status: 'available',
              mode: 'absolute',
              showAbsolute: true,
              showPercentage: false,
              remaining: 8,
              remainingPercent: null,
              thresholdPercent: 15,
            },
          },
        ],
        images: [
          {
            id: 'img_1',
            url: 'https://cdn.jdm.app/store/camiseta-1.jpg',
            alt: 'Camiseta preta JDM',
            sortOrder: 0,
          },
        ],
        createdAt: '2026-05-07T12:00:00.000Z',
        updatedAt: '2026-05-07T12:30:00.000Z',
      }),
    ).not.toThrow();
  });
});
