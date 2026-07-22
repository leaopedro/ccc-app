import type { PremiumAddonModule } from '@jdm/shared/premium-catalog';
import { useCallback, useEffect, useState } from 'react';

import { listPremiumAddonModules } from '~/api/premium-catalog';

type UsePremiumAddonModulesResult = {
  modules: PremiumAddonModule[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

// GET /api/addon-modules (public). Ordered by sortOrder server-side.
export function usePremiumAddonModules(): UsePremiumAddonModulesResult {
  const [modules, setModules] = useState<PremiumAddonModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await listPremiumAddonModules();
      setModules(response.modules);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { modules, loading, error, refresh };
}
