import type { PremiumPlan } from '@ccc/shared/premium-catalog';
import { useCallback, useEffect, useState } from 'react';

import { listPremiumPlans } from '~/api/premium-catalog';

type UsePremiumPlansResult = {
  plans: PremiumPlan[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

// GET /api/plans (public). Ordered by sortOrder server-side.
export function usePremiumPlans(): UsePremiumPlansResult {
  const [plans, setPlans] = useState<PremiumPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await listPremiumPlans();
      setPlans(response.plans);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { plans, loading, error, refresh };
}
