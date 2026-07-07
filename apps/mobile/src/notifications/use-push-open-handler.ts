import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

const handleNotificationData = (data: Record<string, unknown> | null | undefined): void => {
  if (data?.route === 'notifications') {
    router.push('/notifications' as never);
  }
};

// Module-level flag — survives component remounts within one app lifecycle.
// React refs reset on unmount/remount, so a ref would re-consume the stale
// response when Gate remounts during auth state transitions.
let coldStartResponseConsumed = false;

export const usePushOpenHandler = (): void => {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Cold-start: app launched by tapping a notification while terminated.
    // Only process once per app lifecycle to prevent stale response re-routing
    // on later Gate remounts.
    if (!coldStartResponseConsumed) {
      coldStartResponseConsumed = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) {
          handleNotificationData(
            response.notification.request.content.data as Record<string, unknown>,
          );
        }
      });
    }

    // Foreground/background: app already running when user taps notification.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationData(response.notification.request.content.data as Record<string, unknown>);
    });

    return () => sub.remove();
  }, []);
};
