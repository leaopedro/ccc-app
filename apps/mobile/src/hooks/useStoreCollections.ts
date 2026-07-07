import type { StoreCollection } from '@jdm/shared/store';
import { useCallback, useEffect, useState } from 'react';

import { listStoreCollections } from '~/api/store';

type UseStoreCollectionsResult = {
  items: StoreCollection[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useStoreCollections(): UseStoreCollectionsResult {
  const [items, setItems] = useState<StoreCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await listStoreCollections();
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
