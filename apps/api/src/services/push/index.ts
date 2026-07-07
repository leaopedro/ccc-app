import type { Env } from '../../env.js';

import { DevPushSender } from './dev.js';
import { ExpoPushSender } from './expo.js';
import type { PushSender } from './types.js';

export type { PushSender, PushMessage, PushSendResult, PushSendOutcome } from './types.js';
export { DevPushSender } from './dev.js';

export const buildPushSender = (env: Env): PushSender => {
  if (env.PUSH_PROVIDER === 'expo') {
    return new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
  }
  if (env.PUSH_PROVIDER === 'dev') {
    return new DevPushSender();
  }
  // auto: behavior tied to NODE_ENV.
  if (env.NODE_ENV === 'production') {
    return new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
  }
  return new DevPushSender();
};
