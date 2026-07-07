import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { ensurePushPermission } from './permission';
import { registerExpoPushToken } from './register';

import { registerDeviceToken } from '~/api/device-tokens';

export type UsePushRegistrationDeps = { isAuthenticated: boolean };

export const usePushRegistration = ({ isAuthenticated }: UsePushRegistrationDeps): void => {
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }
    if (!isAuthenticated) {
      lastSent.current = null;
      return undefined;
    }

    const send = async (token: string, platform: 'ios' | 'android') => {
      if (lastSent.current === token) return;
      try {
        await registerDeviceToken({ expoPushToken: token, platform });
        lastSent.current = token;
      } catch {
        // Server-side dedupe + lastSeenAt bump handle retry on next boot.
      }
    };

    const boot = async () => {
      const perm = await ensurePushPermission();
      if (perm !== 'granted') return;
      const result = await registerExpoPushToken();
      if (!result.ok) return;
      await send(result.token, result.platform);
    };
    void boot();

    // NOTE: `addPushTokenListener` fires with `DevicePushToken` (the native
    // APNs/FCM raw token), NOT the Expo wrapper token. Writing `event.data`
    // straight to `/me/device-tokens` would persist a non-Expo string that
    // Expo's push service immediately rejects (and that pollutes DeviceToken
    // with rows like `b6aab6ef…` hex — JDMA-534 debugging).
    //
    // On rotation, re-run the full boot path so we re-fetch a fresh Expo
    // push token via `getExpoPushTokenAsync` and persist that instead.
    const sub = Notifications.addPushTokenListener(() => {
      void boot();
    });

    return () => {
      sub.remove();
    };
  }, [isAuthenticated]);
};
