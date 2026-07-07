import { brand } from '@jdm/design';

const STORAGE_PREFIX = `${brand.app.storagePrefix}:pendingCheckoutUrl:`;

function storageKey(orderId: string): string {
  return `${STORAGE_PREFIX}${orderId}`;
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export interface PendingCheckoutStorageOptions {
  storage?: Storage | null;
}

export function setPendingCheckoutUrl(
  orderId: string,
  checkoutUrl: string,
  options: PendingCheckoutStorageOptions = {},
): void {
  if (!orderId || !checkoutUrl) return;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return;
  try {
    storage.setItem(storageKey(orderId), checkoutUrl);
  } catch {
    // storage may be full or blocked; resume will fall back to the
    // "no stored URL" branch in the UI.
  }
}

export function getPendingCheckoutUrl(
  orderId: string,
  options: PendingCheckoutStorageOptions = {},
): string | null {
  if (!orderId) return null;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return null;
  try {
    return storage.getItem(storageKey(orderId));
  } catch {
    return null;
  }
}

export function clearPendingCheckoutUrl(
  orderId: string,
  options: PendingCheckoutStorageOptions = {},
): void {
  if (!orderId) return;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return;
  try {
    storage.removeItem(storageKey(orderId));
  } catch {
    // ignore
  }
}
