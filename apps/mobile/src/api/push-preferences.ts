import {
  pushPrefsSchema,
  updatePushPrefsRequestSchema,
  type PushPrefs,
  type UpdatePushPrefsRequest,
} from '@jdm/shared';

import { authedRequest } from './client';

export const getBroadcastPreferences = (): Promise<PushPrefs> =>
  authedRequest('/me/push-preferences', pushPrefsSchema);

export const updateBroadcastPreferences = (input: UpdatePushPrefsRequest): Promise<PushPrefs> => {
  const parsed = updatePushPrefsRequestSchema.parse(input);
  return authedRequest('/me/push-preferences', pushPrefsSchema, {
    method: 'PATCH',
    body: parsed,
  });
};
