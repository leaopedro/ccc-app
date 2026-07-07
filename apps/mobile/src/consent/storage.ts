import { brand } from '@jdm/design';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = `@${brand.app.storagePrefix}/consent/marketing/seen/v1`;

export const hasSeenMarketingConsentPrompt = async (): Promise<boolean> => {
  const val = await AsyncStorage.getItem(KEY);
  return val === '1';
};

export const markMarketingConsentPromptSeen = async (): Promise<void> => {
  await AsyncStorage.setItem(KEY, '1');
};
