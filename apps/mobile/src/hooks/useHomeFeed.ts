import type { HomeFeedItem } from '@ccc/shared/feed';
import { useCallback, useEffect, useState } from 'react';

import { listHomeFeed } from '~/api/home-feed';

type UseHomeFeedResult = {
  posts: HomeFeedItem[];
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Sem estado de erro exposto: a seção some quando a lista está vazia, e falha
 * de rede colapsa para o mesmo vazio. Mesmo tratamento de
 * ConfirmedCarsSection — uma seção de descoberta não ganha spinner nem retry
 * próprio numa tela que já tem dez blocos.
 */
export function useHomeFeed(): UseHomeFeedResult {
  const [posts, setPosts] = useState<HomeFeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPosts((await listHomeFeed()).posts);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { posts, loading, refresh };
}
