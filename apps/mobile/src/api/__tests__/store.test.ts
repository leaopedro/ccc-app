import {
  shippingAddressInputSchema,
  shippingAddressRecordSchema,
  storeCollectionListResponseSchema,
  storeProductDetailResponseSchema,
  storeProductListResponseSchema,
  storeSettingsSchema,
  storeProductTypeListResponseSchema,
} from '@jdm/shared/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const {
  createShippingAddress,
  deleteShippingAddress,
  getStoreProduct,
  getStoreSettings,
  listShippingAddresses,
  listStoreCollections,
  listStoreProductTypes,
  listStoreProducts,
  registerTokenProvider,
  updateShippingAddress,
} = await import('../store');

describe('mobile store API client', () => {
  const fetchMock = vi.fn();
  const original = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    registerTokenProvider({
      getAccessToken: () => 'token-123',
      refresh: vi.fn().mockResolvedValue('token-123'),
      onSignOut: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('lists storefront collections and product types over the public API', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            storeCollectionListResponseSchema.parse({
              items: [
                {
                  id: 'col_1',
                  slug: 'colecao-jdm',
                  title: 'Colecao JDM',
                  description: null,
                  heroImageUrl: null,
                  sortOrder: 0,
                  productCount: 2,
                },
              ],
            }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            storeProductTypeListResponseSchema.parse({
              items: [
                {
                  id: 'type_1',
                  slug: 'vestuario-acessorios',
                  name: 'Vestuário e Acessórios',
                  description: null,
                },
              ],
            }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const collections = await listStoreCollections();
    const productTypes = await listStoreProductTypes();

    expect(collections.items).toHaveLength(1);
    expect(productTypes.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:4000/store/collections', {
      headers: { 'content-type': 'application/json' },
      method: 'GET',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:4000/store/product-types', {
      headers: { 'content-type': 'application/json' },
      method: 'GET',
    });
  });

  it('loads public store settings for event pickup gating', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          storeSettingsSchema.parse({
            id: 'store_default',
            storeEnabled: true,
            defaultShippingFeeCents: 0,
            lowStockThreshold: 5,
            storeHeaderTitle: 'Drop novo. Corre antes que acabe.',
            storeHeaderSubtitle: 'Itens oficiais da cena JDM com estoque limitado.',
            eventPickupEnabled: true,
            pickupDisplayLabel: 'Retirada no evento',
            supportPhone: null,
            updatedAt: '2026-05-09T10:00:00.000Z',
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const settings = await getStoreSettings();

    expect(settings.eventPickupEnabled).toBe(true);
    expect(settings.storeHeaderTitle).toBe('Drop novo. Corre antes que acabe.');
    expect(settings.storeHeaderSubtitle).toBe('Itens oficiais da cena JDM com estoque limitado.');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/store/settings', {
      headers: { 'content-type': 'application/json' },
      method: 'GET',
    });
  });

  it('serializes product list query params against the shared store schema', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          storeProductListResponseSchema.parse({
            items: [],
            nextCursor: 'cursor_2',
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await listStoreProducts({
      q: 'camiseta',
      collectionSlug: 'drops-jdm',
      productTypeSlug: 'vestuario',
      inStock: true,
      sort: 'price_desc',
      cursor: 'cursor_1',
      limit: 12,
    });

    expect(response.nextCursor).toBe('cursor_2');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/store/products?q=camiseta&collectionSlug=drops-jdm&productTypeSlug=vestuario&inStock=true&sort=price_desc&cursor=cursor_1&limit=12',
      {
        headers: { 'content-type': 'application/json' },
        method: 'GET',
      },
    );
  });

  it('fetches a single storefront product by slug', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          storeProductDetailResponseSchema.parse({
            product: {
              id: 'prod_1',
              slug: 'camiseta-jdm',
              title: 'Camiseta JDM',
              description: 'Malha pesada',
              shortDescription: 'Malha',
              status: 'active',
              canShip: true,
              canPickup: false,
              coverImageUrl: 'https://cdn.example.com/p1.jpg',
              collectionIds: ['col_1'],
              productType: {
                id: 'type_1',
                slug: 'vestuario',
                name: 'Vestuário',
                description: null,
              },
              variants: [
                {
                  id: 'var_1',
                  sku: 'SKU-1',
                  title: 'M',
                  priceCents: 9900,
                  displayPriceCents: 10890,
                  devFeePercent: 10,
                  compareAtPriceCents: null,
                  currency: 'BRL',
                  stockOnHand: 5,
                  isActive: true,
                  capacityDisplay: {
                    status: 'available',
                    mode: 'absolute',
                    showAbsolute: true,
                    showPercentage: false,
                    remaining: 5,
                    remainingPercent: null,
                    thresholdPercent: 15,
                  },
                },
              ],
              images: [
                {
                  id: 'img_1',
                  url: 'https://cdn.example.com/p1.jpg',
                  alt: null,
                  sortOrder: 0,
                },
              ],
              createdAt: '2026-05-01T10:00:00.000Z',
              updatedAt: '2026-05-02T10:00:00.000Z',
            },
            collections: [],
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await getStoreProduct('camiseta jdm');

    expect(response.product.slug).toBe('camiseta-jdm');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/store/products/camiseta%20jdm', {
      headers: { 'content-type': 'application/json' },
      method: 'GET',
    });
  });

  it('uses authenticated shipping address endpoints for list, create, update, and delete', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              shippingAddressRecordSchema.parse({
                id: 'addr_1',
                recipientName: 'Pedro',
                phone: '11999999999',
                postalCode: '01001-000',
                street: 'Rua A',
                number: '10',
                complement: null,
                neighborhood: 'Centro',
                city: 'São Paulo',
                stateCode: 'SP',
                countryCode: 'BR',
                isDefault: true,
                createdAt: '2026-05-01T10:00:00.000Z',
                updatedAt: '2026-05-01T10:00:00.000Z',
              }),
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            shippingAddressRecordSchema.parse({
              id: 'addr_2',
              ...shippingAddressInputSchema.parse({
                recipientName: 'Maria',
                phone: '11988888888',
                postalCode: '01310-100',
                street: 'Av. Paulista',
                number: '1000',
                complement: 'Ap 12',
                neighborhood: 'Bela Vista',
                city: 'São Paulo',
                stateCode: 'SP',
                countryCode: 'BR',
              }),
              isDefault: false,
              createdAt: '2026-05-02T10:00:00.000Z',
              updatedAt: '2026-05-02T10:00:00.000Z',
            }),
          ),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            shippingAddressRecordSchema.parse({
              id: 'addr_2',
              recipientName: 'Maria Silva',
              phone: '11988888888',
              postalCode: '01310-100',
              street: 'Av. Paulista',
              number: '1000',
              complement: 'Ap 12',
              neighborhood: 'Bela Vista',
              city: 'São Paulo',
              stateCode: 'SP',
              countryCode: 'BR',
              isDefault: true,
              createdAt: '2026-05-02T10:00:00.000Z',
              updatedAt: '2026-05-03T10:00:00.000Z',
            }),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const createInput = {
      recipientName: 'Maria',
      phone: '11988888888',
      postalCode: '01310-100',
      street: 'Av. Paulista',
      number: '1000',
      complement: 'Ap 12',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      stateCode: 'SP' as const,
      countryCode: 'BR' as const,
    };

    const listed = await listShippingAddresses();
    const created = await createShippingAddress(createInput);
    const updated = await updateShippingAddress('addr_2', {
      recipientName: 'Maria Silva',
      isDefault: true,
    });
    const deleted = await deleteShippingAddress('addr_2');

    expect(listed.items).toHaveLength(1);
    expect(created.id).toBe('addr_2');
    expect(updated.recipientName).toBe('Maria Silva');
    expect(deleted).toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:4000/me/shipping-addresses', {
      headers: { authorization: 'Bearer token-123' },
      method: 'GET',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:4000/me/shipping-addresses', {
      body: JSON.stringify(createInput),
      headers: {
        authorization: 'Bearer token-123',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:4000/me/shipping-addresses/addr_2',
      {
        body: JSON.stringify({ recipientName: 'Maria Silva', isDefault: true }),
        headers: {
          authorization: 'Bearer token-123',
          'content-type': 'application/json',
        },
        method: 'PATCH',
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://localhost:4000/me/shipping-addresses/addr_2',
      {
        headers: { authorization: 'Bearer token-123' },
        method: 'DELETE',
      },
    );
  });
});
