import { brand } from '@ccc/design';

const ACCESS_KEY = `${brand.app.storagePrefix}.auth.access`;
const REFRESH_KEY = `${brand.app.storagePrefix}.auth.refresh`;

export type StoredTokens = { accessToken: string; refreshToken: string };

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const saveTokens = (tokens: StoredTokens): Promise<void> => {
  const s = getStorage();
  if (s) {
    s.setItem(ACCESS_KEY, tokens.accessToken);
    s.setItem(REFRESH_KEY, tokens.refreshToken);
  }
  return Promise.resolve();
};

export const loadTokens = (): Promise<StoredTokens | null> => {
  const s = getStorage();
  if (!s) return Promise.resolve(null);
  const accessToken = s.getItem(ACCESS_KEY);
  const refreshToken = s.getItem(REFRESH_KEY);
  if (!accessToken || !refreshToken) return Promise.resolve(null);
  return Promise.resolve({ accessToken, refreshToken });
};

export const clearTokens = (): Promise<void> => {
  const s = getStorage();
  if (s) {
    s.removeItem(ACCESS_KEY);
    s.removeItem(REFRESH_KEY);
  }
  return Promise.resolve();
};
