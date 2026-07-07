import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  throw new Error(
    "Cannot read properties of undefined (reading 'bind') - " +
      'simulates AsyncStorage import failure on web',
  );
});

const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
};

vi.stubGlobal('window', { localStorage: mockLocalStorage });

describe('marketing consent storage web implementation', () => {
  beforeEach(() => {
    store.clear();
  });

  it('does not import AsyncStorage on web platform', async () => {
    const storage = await import('../storage.web');

    expect(storage.hasSeenMarketingConsentPrompt).toBeInstanceOf(Function);
    expect(storage.markMarketingConsentPromptSeen).toBeInstanceOf(Function);
  });

  it('persists the seen flag in localStorage', async () => {
    const { hasSeenMarketingConsentPrompt, markMarketingConsentPromptSeen } =
      await import('../storage.web');

    await expect(hasSeenMarketingConsentPrompt()).resolves.toBe(false);

    await markMarketingConsentPromptSeen();

    await expect(hasSeenMarketingConsentPrompt()).resolves.toBe(true);
  });
});
