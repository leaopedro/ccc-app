// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { migrateLegacyStorageKeys } from '../legacy-storage-migration.web';

// The migration derives the new prefix from brand.app.storagePrefix ('ccc').
const NEW = 'ccc';
const OLD = 'jdm';

describe('migrateLegacyStorageKeys (web)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('renames localStorage auth + tickets + consent keys and drops legacy', async () => {
    window.localStorage.setItem(`${OLD}.auth.access`, 'access-tok');
    window.localStorage.setItem(`${OLD}.auth.refresh`, 'refresh-tok');
    window.localStorage.setItem(`@${OLD}/tickets/offline-store/v1`, '{"a":1}');
    window.localStorage.setItem(`@${OLD}/consent/marketing/seen/v1`, '1');

    await migrateLegacyStorageKeys();

    expect(window.localStorage.getItem(`${NEW}.auth.access`)).toBe('access-tok');
    expect(window.localStorage.getItem(`${NEW}.auth.refresh`)).toBe('refresh-tok');
    expect(window.localStorage.getItem(`@${NEW}/tickets/offline-store/v1`)).toBe('{"a":1}');
    expect(window.localStorage.getItem(`@${NEW}/consent/marketing/seen/v1`)).toBe('1');

    expect(window.localStorage.getItem(`${OLD}.auth.access`)).toBeNull();
    expect(window.localStorage.getItem(`@${OLD}/tickets/offline-store/v1`)).toBeNull();
  });

  it('renames sessionStorage pendingOrderId + the pendingCheckoutUrl:<id> family', async () => {
    window.sessionStorage.setItem(`${OLD}:pendingOrderId`, 'order-1');
    window.sessionStorage.setItem(`${OLD}:pendingCheckoutUrl:order-1`, 'https://pay/1');
    window.sessionStorage.setItem(`${OLD}:pendingCheckoutUrl:order-2`, 'https://pay/2');

    await migrateLegacyStorageKeys();

    expect(window.sessionStorage.getItem(`${NEW}:pendingOrderId`)).toBe('order-1');
    expect(window.sessionStorage.getItem(`${NEW}:pendingCheckoutUrl:order-1`)).toBe(
      'https://pay/1',
    );
    expect(window.sessionStorage.getItem(`${NEW}:pendingCheckoutUrl:order-2`)).toBe(
      'https://pay/2',
    );

    expect(window.sessionStorage.getItem(`${OLD}:pendingOrderId`)).toBeNull();
    expect(window.sessionStorage.getItem(`${OLD}:pendingCheckoutUrl:order-1`)).toBeNull();
  });

  it('does not clobber a value already written under the new key', async () => {
    window.localStorage.setItem(`${OLD}.auth.access`, 'legacy');
    window.localStorage.setItem(`${NEW}.auth.access`, 'fresh');

    await migrateLegacyStorageKeys();

    expect(window.localStorage.getItem(`${NEW}.auth.access`)).toBe('fresh');
    expect(window.localStorage.getItem(`${OLD}.auth.access`)).toBeNull();
  });

  it('is a no-op after the done-flag is set (runs once)', async () => {
    await migrateLegacyStorageKeys();
    // Seed a legacy key AFTER the first run completed and set the flag.
    window.localStorage.setItem(`${OLD}.auth.access`, 'late');

    await migrateLegacyStorageKeys();

    // Second run short-circuits on the done-flag; legacy key is left untouched.
    expect(window.localStorage.getItem(`${NEW}.auth.access`)).toBeNull();
    expect(window.localStorage.getItem(`${OLD}.auth.access`)).toBe('late');
  });
});
