import * as SecureStore from 'expo-secure-store';

import { brand } from '@jdm/design';

const ACCESS_KEY = `${brand.app.storagePrefix}.auth.access`;
const REFRESH_KEY = `${brand.app.storagePrefix}.auth.refresh`;

export type StoredTokens = { accessToken: string; refreshToken: string };

export const saveTokens = async (tokens: StoredTokens): Promise<void> => {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
  ]);
};

export const loadTokens = async (): Promise<StoredTokens | null> => {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
};

export const clearTokens = async (): Promise<void> => {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
};
