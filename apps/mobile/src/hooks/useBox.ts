import type { BoxView } from '@ccc/shared/box';
import { useCallback, useEffect, useState } from 'react';

import { getBox } from '~/api/box';
import { ApiError } from '~/api/client';

type UseBoxResult = {
  box: BoxView | null;
  loading: boolean;
  error: boolean;
  notOpen: boolean;
  refresh: () => Promise<void>;
};

export function useBox(enabled = true): UseBoxResult {
  const [box, setBox] = useState<BoxView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [notOpen, setNotOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(false);
    setNotOpen(false);
    try {
      setBox(await getBox());
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setBox(null);
        setNotOpen(true);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { box, loading, error, notOpen, refresh };
}
