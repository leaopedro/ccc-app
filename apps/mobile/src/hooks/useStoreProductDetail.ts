import type { StoreCollection, StoreProduct } from '@jdm/shared/store';
import { useCallback, useEffect, useState } from 'react';

import { getStoreProduct } from '~/api/store';

type UseStoreProductDetailResult = {
  product: StoreProduct | null;
  collections: StoreCollection[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useStoreProductDetail(slug: string | undefined): UseStoreProductDetailResult {
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [collections, setCollections] = useState<StoreCollection[]>([]);
  const [loading, setLoading] = useState(Boolean(slug));
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!slug) {
      setProduct(null);
      setCollections([]);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const response = await getStoreProduct(slug);
      setProduct(response.product);
      setCollections(response.collections);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { product, collections, loading, error, refresh };
}
