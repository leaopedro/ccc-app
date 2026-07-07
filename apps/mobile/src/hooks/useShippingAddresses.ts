import type { ShippingAddressRecord } from '@jdm/shared/store';
import { useCallback, useEffect, useState } from 'react';

import { listShippingAddresses } from '~/api/store';

type UseShippingAddressesResult = {
  items: ShippingAddressRecord[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useShippingAddresses(enabled = true): UseShippingAddressesResult {
  const [items, setItems] = useState<ShippingAddressRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const response = await listShippingAddresses();
      setItems(response.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}
