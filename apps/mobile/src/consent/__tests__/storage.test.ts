import { beforeEach, expect, test, vi } from 'vitest';

import { hasSeenMarketingConsentPrompt, markMarketingConsentPromptSeen } from '../storage';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    clear: () => {
      store.clear();
      return Promise.resolve();
    },
  },
}));

beforeEach(() => {
  store.clear();
});

test('hasSeenMarketingConsentPrompt returns false when not set', async () => {
  await expect(hasSeenMarketingConsentPrompt()).resolves.toBe(false);
});

test('markMarketingConsentPromptSeen sets flag', async () => {
  await markMarketingConsentPromptSeen();
  await expect(hasSeenMarketingConsentPrompt()).resolves.toBe(true);
});
