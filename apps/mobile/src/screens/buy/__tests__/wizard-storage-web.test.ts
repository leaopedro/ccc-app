import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  throw new Error(
    "Cannot read properties of undefined (reading 'bind') — " +
      'simulates merge-options CJS/ESM interop failure on web',
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
vi.stubGlobal('localStorage', mockLocalStorage);

describe('wizardStorage web implementation', () => {
  beforeEach(() => {
    store.clear();
  });

  it('does not import AsyncStorage on web platform', async () => {
    const { wizardStorage } = await import('../per-ticket-wizard/storage.web');
    expect(wizardStorage).toBeDefined();
    expect(wizardStorage.getItem).toBeInstanceOf(Function);
    expect(wizardStorage.setItem).toBeInstanceOf(Function);
    expect(wizardStorage.removeItem).toBeInstanceOf(Function);
  });

  it('reads and writes via localStorage', async () => {
    const { wizardStorage } = await import('../per-ticket-wizard/storage.web');
    await wizardStorage.setItem('test-key', '{"foo":"bar"}');
    const result = await wizardStorage.getItem('test-key');
    expect(result).toBe('{"foo":"bar"}');
  });

  it('removes items from localStorage', async () => {
    const { wizardStorage } = await import('../per-ticket-wizard/storage.web');
    store.set('rm-key', 'value');
    await wizardStorage.removeItem('rm-key');
    expect(store.has('rm-key')).toBe(false);
  });

  it('returns null for missing keys', async () => {
    const { wizardStorage } = await import('../per-ticket-wizard/storage.web');
    const result = await wizardStorage.getItem('nonexistent');
    expect(result).toBeNull();
  });
});
