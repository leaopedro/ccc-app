import type { HomeContentResponse } from '@ccc/shared/home';
import { useCallback, useEffect, useState } from 'react';

import { getHomeContent } from '~/api/home';

type UseHomeContentResult = {
  content: HomeContentResponse | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

// GET /api/home-content (público). Uma request cobre a tela inteira, então a
// falha é total: não há degradação parcial por bloco.
export function useHomeContent(): UseHomeContentResult {
  const [content, setContent] = useState<HomeContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setContent(await getHomeContent());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { content, loading, error, refresh };
}
