import {
  registerDeviceTokenRequestSchema,
  registerDeviceTokenResponseSchema,
  type RegisterDeviceTokenRequest,
} from '@jdm/shared/push';

import { authedRequest } from './client';

export const registerDeviceToken = (input: RegisterDeviceTokenRequest) =>
  authedRequest('/me/device-tokens', registerDeviceTokenResponseSchema, {
    method: 'POST',
    body: registerDeviceTokenRequestSchema.parse(input),
  });
