import { brand } from '@jdm/design';

const KEY = `@${brand.app.storagePrefix}/consent/marketing/seen/v1`;

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const hasSeenMarketingConsentPrompt = (): Promise<boolean> => {
  const storage = getStorage();
  return Promise.resolve(storage?.getItem(KEY) === '1');
};

export const markMarketingConsentPromptSeen = (): Promise<void> => {
  const storage = getStorage();
  storage?.setItem(KEY, '1');
  return Promise.resolve();
};
