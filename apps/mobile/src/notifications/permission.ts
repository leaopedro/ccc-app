import * as Notifications from 'expo-notifications';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export const ensurePushPermission = async (): Promise<PushPermission> => {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';
  if (existing.canAskAgain === false) return 'denied';
  const result = await Notifications.requestPermissionsAsync();
  if (result.granted) return 'granted';
  return result.canAskAgain ? 'undetermined' : 'denied';
};
