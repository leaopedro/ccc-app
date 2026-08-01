import { brand } from '@ccc/design';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// One-time boot migration: JDM -> CCC persisted-key rename.
//
// The brand `storagePrefix` flipped 'jdm' -> 'ccc'. Users upgrading from an
// old build still hold their session tokens, offline tickets, and consent
// flag under the legacy 'jdm' keys. Runtime now only reads/writes 'ccc' keys,
// so without this pass those users would appear logged out and lose offline
// data on first launch of the rebranded build.
//
// Strategy: read legacy -> write new (only when the new key is absent, so a
// re-run never clobbers fresh data) -> delete legacy. Guarded by a done-flag
// so it runs exactly once. Best-effort: any storage error is swallowed; a
// failed migration must never block boot.

const LEGACY_PREFIX = 'jdm';
const NEW_PREFIX = brand.app.storagePrefix;

const DONE_FLAG = `${NEW_PREFIX}.migrations.legacyPrefix.done`;

// SecureStore-backed auth tokens. Suffixes mirror auth/storage.ts.
const SECURE_SUFFIXES = ['.auth.access', '.auth.refresh'] as const;

// AsyncStorage-backed data. Templates mirror offline-storage.ts / consent/storage.ts.
const ASYNC_KEY_TEMPLATES = [
  (p: string) => `@${p}/tickets/offline-store/v1`,
  (p: string) => `@${p}/consent/marketing/seen/v1`,
] as const;

const migrateSecureStore = async (): Promise<void> => {
  for (const suffix of SECURE_SUFFIXES) {
    const legacyKey = `${LEGACY_PREFIX}${suffix}`;
    const newKey = `${NEW_PREFIX}${suffix}`;
    try {
      const legacyValue = await SecureStore.getItemAsync(legacyKey);
      if (legacyValue == null) continue;
      const existing = await SecureStore.getItemAsync(newKey);
      if (existing == null) {
        await SecureStore.setItemAsync(newKey, legacyValue);
      }
      await SecureStore.deleteItemAsync(legacyKey);
    } catch {
      // ignore per-key failure; boot continues.
    }
  }
};

const migrateAsyncStorage = async (): Promise<void> => {
  for (const template of ASYNC_KEY_TEMPLATES) {
    const legacyKey = template(LEGACY_PREFIX);
    const newKey = template(NEW_PREFIX);
    try {
      const legacyValue = await AsyncStorage.getItem(legacyKey);
      if (legacyValue == null) continue;
      const existing = await AsyncStorage.getItem(newKey);
      if (existing == null) {
        await AsyncStorage.setItem(newKey, legacyValue);
      }
      await AsyncStorage.removeItem(legacyKey);
    } catch {
      // ignore per-key failure; boot continues.
    }
  }
};

export const migrateLegacyStorageKeys = async (): Promise<void> => {
  try {
    const done = await AsyncStorage.getItem(DONE_FLAG);
    if (done === '1') return;
  } catch {
    // If we can't read the flag we still attempt the (idempotent) migration.
  }

  await migrateSecureStore();
  await migrateAsyncStorage();

  try {
    await AsyncStorage.setItem(DONE_FLAG, '1');
  } catch {
    // Flag write failed; migration is idempotent so a re-run is harmless.
  }
};
