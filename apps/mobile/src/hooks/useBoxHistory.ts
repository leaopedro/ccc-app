import type { BoxHistory } from '@ccc/shared/box';
import { useCallback, useEffect, useState } from 'react';

import { getBoxHistory } from '~/api/box';

type UseBoxHistoryResult = {
  entries: BoxHistory;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useBoxHistory(enabled = true): UseBoxHistoryResult {
  const [entries, setEntries] = useState<BoxHistory>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setEntries([]);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      setEntries(await getBoxHistory());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}
