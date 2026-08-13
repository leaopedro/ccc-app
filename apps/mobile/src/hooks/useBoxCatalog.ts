import type { BoxCatalog } from '@ccc/shared/box';
import { useCallback, useEffect, useState } from 'react';

import { getBoxCatalog } from '~/api/box';

type UseBoxCatalogResult = {
  catalog: BoxCatalog | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useBoxCatalog(enabled = true): UseBoxCatalogResult {
  const [catalog, setCatalog] = useState<BoxCatalog | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(false);
    try {
      setCatalog(await getBoxCatalog());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { catalog, loading, error, refresh };
}
