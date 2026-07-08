import { brand } from '@ccc/design';

// Web twin of legacy-storage-migration.ts (JDM -> CCC persisted-key rename).
// See the native file for rationale. On web the auth tokens, offline tickets,
// and consent flag live in localStorage; the in-flight checkout keys live in
// sessionStorage. All are keyed off the brand `storagePrefix`.

const LEGACY_PREFIX = 'jdm';
const NEW_PREFIX = brand.app.storagePrefix;

const DONE_FLAG = `${NEW_PREFIX}.migrations.legacyPrefix.done`;

// localStorage keys: auth tokens (auth/storage.web.ts), offline tickets
// (offline-storage.web.ts), consent flag (consent/storage.web.ts).
const LOCAL_KEY_TEMPLATES = [
  (p: string) => `${p}.auth.access`,
  (p: string) => `${p}.auth.refresh`,
  (p: string) => `@${p}/tickets/offline-store/v1`,
  (p: string) => `@${p}/consent/marketing/seen/v1`,
] as const;

// sessionStorage: single pendingOrderId + the pendingCheckoutUrl:<id> family.
const SESSION_EXACT_TEMPLATES = [(p: string) => `${p}:pendingOrderId`] as const;
const SESSION_CHECKOUT_TEMPLATE = (p: string) => `${p}:pendingCheckoutUrl:`;

const getStorage = (kind: 'local' | 'session'): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

const migrateExact = (
  storage: Storage,
  templates: readonly ((p: string) => string)[],
): void => {
  for (const template of templates) {
    const legacyKey = template(LEGACY_PREFIX);
    const newKey = template(NEW_PREFIX);
    try {
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue == null) continue;
      if (storage.getItem(newKey) == null) {
        storage.setItem(newKey, legacyValue);
      }
      storage.removeItem(legacyKey);
    } catch {
      // ignore per-key failure.
    }
  }
};

// pendingCheckoutUrl keys carry an order-id suffix, so enumerate the prefix.
const migrateCheckoutFamily = (storage: Storage): void => {
  const legacyPrefix = SESSION_CHECKOUT_TEMPLATE(LEGACY_PREFIX);
  const newPrefix = SESSION_CHECKOUT_TEMPLATE(NEW_PREFIX);
  let legacyKeys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(legacyPrefix)) legacyKeys.push(key);
    }
  } catch {
    legacyKeys = [];
  }
  for (const legacyKey of legacyKeys) {
    const newKey = `${newPrefix}${legacyKey.slice(legacyPrefix.length)}`;
    try {
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue == null) continue;
      if (storage.getItem(newKey) == null) {
        storage.setItem(newKey, legacyValue);
      }
      storage.removeItem(legacyKey);
    } catch {
      // ignore per-key failure.
    }
  }
};

export const migrateLegacyStorageKeys = (): Promise<void> => {
  const local = getStorage('local');
  if (local) {
    try {
      if (local.getItem(DONE_FLAG) === '1') return Promise.resolve();
    } catch {
      // fall through and attempt the idempotent migration.
    }
  }

  if (local) migrateExact(local, LOCAL_KEY_TEMPLATES);

  const session = getStorage('session');
  if (session) {
    migrateExact(session, SESSION_EXACT_TEMPLATES);
    migrateCheckoutFamily(session);
  }

  if (local) {
    try {
      local.setItem(DONE_FLAG, '1');
    } catch {
      // idempotent; harmless on re-run.
    }
  }
  return Promise.resolve();
};
