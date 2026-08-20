import type { ClubStatsResponse } from '@ccc/shared/club-stats';
import { useCallback, useEffect, useState } from 'react';

import { getClubStats } from '~/api/club-stats';

type UseClubStatsResult = {
  stats: ClubStatsResponse | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

// GET /api/club-stats (publico). O backend cacheia por cinco minutos, entao
// chamar em toda montagem da tela e barato.
export function useClubStats(): UseClubStatsResult {
  const [stats, setStats] = useState<ClubStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setStats(await getClubStats());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { stats, loading, error, refresh };
}
