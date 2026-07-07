import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const projectId = (): string | undefined => {
  const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
  return extra.eas?.projectId && extra.eas.projectId.length > 0 ? extra.eas.projectId : undefined;
};

export type RegisterResult =
  | { ok: true; token: string; platform: 'ios' | 'android' }
  | { ok: false; reason: 'simulator' | 'no-project-id' | 'sdk-error' };

export const registerExpoPushToken = async (): Promise<RegisterResult> => {
  const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
  if (!Device.isDevice) {
    // Simulators cannot receive push notifications. In dev, return a synthetic
    // token so the DeviceToken row is persisted and F10 smoke can proceed.
    // Expo push service will reject delivery — expected on simulator.
    if (__DEV__) {
      return { ok: true, token: `ExponentPushToken[simulator-${platform}]`, platform };
    }
    return { ok: false, reason: 'simulator' };
  }
  const id = projectId();
  if (!id) {
    // Visible diagnostic — silent failures of this path are what made JDMA-534
    // smoke debugging painful. Most common cause: empty `EAS_PROJECT_ID=` line
    // in apps/mobile/.env.local overriding the value in .env.
    console.warn(
      '[push] registerExpoPushToken: no projectId resolved. Check EAS_PROJECT_ID in apps/mobile/.env / .env.local.',
    );
    return { ok: false, reason: 'no-project-id' };
  }
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return { ok: true, token: result.data, platform };
  } catch (err) {
    console.warn('[push] registerExpoPushToken: SDK error', err);
    return { ok: false, reason: 'sdk-error' };
  }
};
