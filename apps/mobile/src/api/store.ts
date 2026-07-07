import {
  shippingAddressInputSchema,
  shippingAddressListResponseSchema,
  shippingAddressRecordSchema,
  shippingAddressUpdateSchema,
  storeCollectionListResponseSchema,
  storeProductDetailResponseSchema,
  storeProductListQuerySchema,
  storeProductListResponseSchema,
  storeSettingsSchema,
  storeProductTypeListResponseSchema,
  type ShippingAddressInput,
  type ShippingAddressUpdate,
  type StoreCollectionListResponse,
  type StoreProductDetailResponse,
  type StoreProductListQuery,
  type StoreProductListResponse,
  type StoreSettings,
  type StoreProductTypeListResponse,
} from '@jdm/shared/store';
import { z } from 'zod';

import { authedRequest, registerTokenProvider, request } from './client';

const emptyResponseSchema = z.null();
type ShippingAddressListResponse = z.output<typeof shippingAddressListResponseSchema>;
type ShippingAddressRecord = z.output<typeof shippingAddressRecordSchema>;
const shippingAddressListResponseOutputSchema =
  shippingAddressListResponseSchema as z.ZodType<ShippingAddressListResponse>;
const shippingAddressRecordOutputSchema =
  shippingAddressRecordSchema as z.ZodType<ShippingAddressRecord>;

const buildQueryString = (query: Partial<StoreProductListQuery>): string => {
  const parsed = storeProductListQuerySchema.partial().parse(query);
  const params = new URLSearchParams();

  if (parsed.q) params.set('q', parsed.q);
  if (parsed.collectionSlug) params.set('collectionSlug', parsed.collectionSlug);
  if (parsed.productTypeSlug) params.set('productTypeSlug', parsed.productTypeSlug);
  if (parsed.inStock !== undefined) params.set('inStock', String(parsed.inStock));
  if (parsed.sort) params.set('sort', parsed.sort);
  if (parsed.cursor) params.set('cursor', parsed.cursor);
  if (parsed.limit !== undefined) params.set('limit', String(parsed.limit));

  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const listStoreProductTypes = (): Promise<StoreProductTypeListResponse> =>
  request('/store/product-types', storeProductTypeListResponseSchema);

export const listStoreCollections = (): Promise<StoreCollectionListResponse> =>
  request('/store/collections', storeCollectionListResponseSchema);

export const listStoreProducts = (
  query: Partial<StoreProductListQuery> = {},
): Promise<StoreProductListResponse> =>
  request(`/store/products${buildQueryString(query)}`, storeProductListResponseSchema);

export const getStoreProduct = (slug: string): Promise<StoreProductDetailResponse> =>
  request(`/store/products/${encodeURIComponent(slug)}`, storeProductDetailResponseSchema);

export const getStoreSettings = (): Promise<StoreSettings> =>
  request('/store/settings', storeSettingsSchema);

export const listShippingAddresses = (): Promise<ShippingAddressListResponse> =>
  authedRequest<ShippingAddressListResponse>(
    '/me/shipping-addresses',
    shippingAddressListResponseOutputSchema,
  );

export const createShippingAddress = (
  input: ShippingAddressInput,
): Promise<ShippingAddressRecord> =>
  authedRequest<ShippingAddressRecord>(
    '/me/shipping-addresses',
    shippingAddressRecordOutputSchema,
    {
      method: 'POST',
      body: shippingAddressInputSchema.parse(input),
    },
  );

export const updateShippingAddress = (
  id: string,
  input: ShippingAddressUpdate,
): Promise<ShippingAddressRecord> =>
  authedRequest<ShippingAddressRecord>(
    `/me/shipping-addresses/${encodeURIComponent(id)}`,
    shippingAddressRecordOutputSchema,
    {
      method: 'PATCH',
      body: shippingAddressUpdateSchema.parse(input),
    },
  );

export const deleteShippingAddress = async (id: string): Promise<void> => {
  await authedRequest(`/me/shipping-addresses/${encodeURIComponent(id)}`, emptyResponseSchema, {
    method: 'DELETE',
  });
};

export { registerTokenProvider };
