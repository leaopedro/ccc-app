import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { STORE_BUILD_ENABLED, isStoreAvailable, isStoreDisabledError } from './runtime';

import { listStoreProductTypes } from '~/api/store';

type StoreRuntimeContextValue = {
  runtimeStoreEnabled: boolean | null;
};

const StoreRuntimeContext = createContext<StoreRuntimeContextValue | null>(null);

export function StoreRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtimeStoreEnabled, setRuntimeStoreEnabled] = useState<boolean | null>(
    // null = "not yet probed" → store shown optimistically.
    // false = build flag hard-disables; no probe needed.
    STORE_BUILD_ENABLED ? null : false,
  );

  const probe = useCallback(async () => {
    if (!STORE_BUILD_ENABLED) {
      setRuntimeStoreEnabled(false);
      return;
    }

    try {
      await listStoreProductTypes();
      setRuntimeStoreEnabled(true);
    } catch (error: unknown) {
      // Only the specific 503 killswitch response disables the store.
      // Network errors and other failures leave state unchanged so the
      // store remains visible (optimistic default).
      if (isStoreDisabledError(error)) {
        setRuntimeStoreEnabled(false);
      }
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const value = useMemo<StoreRuntimeContextValue>(
    () => ({ runtimeStoreEnabled }),
    [runtimeStoreEnabled],
  );

  return <StoreRuntimeContext.Provider value={value}>{children}</StoreRuntimeContext.Provider>;
}

export function useStoreRuntime(): StoreRuntimeContextValue {
  const value = useContext(StoreRuntimeContext);
  if (!value) {
    throw new Error('useStoreRuntime must be used within StoreRuntimeProvider');
  }
  return value;
}

export function useStoreAvailability(): boolean {
  const { runtimeStoreEnabled } = useStoreRuntime();
  return isStoreAvailable(runtimeStoreEnabled);
}
