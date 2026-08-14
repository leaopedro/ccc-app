import {
  boxViewSchema,
  boxCatalogSchema,
  boxHistorySchema,
  boxSelectionUpdateSchema,
  boxConfirmSchema,
  boxPreferencesSchema,
  boxCheckoutResponseSchema,
  type BoxView,
  type BoxCatalog,
  type BoxHistory,
  type BoxSelectionUpdate,
  type BoxConfirm,
  type BoxPreferences,
  type BoxCheckoutResponse,
} from '@ccc/shared/box';
import { z } from 'zod';

import { authedRequest } from './client';

const emptyResponseSchema = z.null();

export const getBox = (): Promise<BoxView> =>
  authedRequest('/me/box', boxViewSchema as z.ZodType<BoxView>);

export const getBoxCatalog = (): Promise<BoxCatalog> =>
  authedRequest('/me/box/catalog', boxCatalogSchema as z.ZodType<BoxCatalog>);

export const getBoxHistory = (): Promise<BoxHistory> =>
  authedRequest('/me/boxes', boxHistorySchema as z.ZodType<BoxHistory>);

export const updateBoxSelection = (input: BoxSelectionUpdate): Promise<BoxView> =>
  authedRequest('/me/box/selection', boxViewSchema as z.ZodType<BoxView>, {
    method: 'PUT',
    body: boxSelectionUpdateSchema.parse(input),
  });

export const confirmBox = (input: BoxConfirm): Promise<BoxView> =>
  authedRequest('/me/box/confirm', boxViewSchema as z.ZodType<BoxView>, {
    method: 'POST',
    body: boxConfirmSchema.parse(input),
  });

export const setBoxPreferences = async (input: BoxPreferences): Promise<void> => {
  await authedRequest('/me/box/preferences', emptyResponseSchema, {
    method: 'PUT',
    body: boxPreferencesSchema.parse(input),
  });
};

export const skipBox = async (): Promise<void> => {
  await authedRequest('/me/box/skip', emptyResponseSchema, { method: 'POST' });
};

export const unskipBox = async (): Promise<void> => {
  await authedRequest('/me/box/unskip', emptyResponseSchema, { method: 'POST' });
};

export const checkoutBox = (): Promise<BoxCheckoutResponse> =>
  authedRequest('/me/box/checkout', boxCheckoutResponseSchema as z.ZodType<BoxCheckoutResponse>, {
    method: 'POST',
  });
