import { ApiError } from '../api/client';

export const STORE_BUILD_ENABLED = process.env.EXPO_PUBLIC_STORE_ENABLED !== 'false';

type ServiceUnavailableBody = {
  error?: unknown;
  message?: unknown;
};

export function isStoreDisabledError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 503) {
    return false;
  }

  const body = error.body;
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const { error: code, message } = body as ServiceUnavailableBody;
  return code === 'ServiceUnavailable' && message === 'store is currently disabled';
}

export function isStoreAvailable(runtimeStoreEnabled: boolean | null): boolean {
  if (!STORE_BUILD_ENABLED) {
    return false;
  }

  return runtimeStoreEnabled !== false;
}

export function resolveStoreSlot(runtimeStoreEnabled: boolean | null): 'store' | 'tickets' {
  return isStoreAvailable(runtimeStoreEnabled) ? 'store' : 'tickets';
}
