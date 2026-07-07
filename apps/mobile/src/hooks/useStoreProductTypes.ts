import type { StoreProductType } from '@jdm/shared/store';
import { useCallback, useEffect, useState } from 'react';

import { listStoreProductTypes } from '~/api/store';

type UseStoreProductTypesResult = {
  items: StoreProductType[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useStoreProductTypes(): UseStoreProductTypesResult {
  const [items, setItems] = useState<StoreProductType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await listStoreProductTypes();
      setItems(response.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}
