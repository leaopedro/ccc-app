import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { getUnreadCount } from '~/api/notifications';

const POLL_INTERVAL_MS = 60_000;

export function useUnreadCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  const fetch = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await getUnreadCount();
      if (activeRef.current) setCount(res.unread);
    } catch {
      // silent — stale badge OK
    }
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      activeRef.current = true;
      void fetch();

      const schedule = () => {
        timerRef.current = setTimeout(() => {
          void fetch();
          schedule();
        }, POLL_INTERVAL_MS);
      };
      schedule();

      return () => {
        activeRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, [enabled, fetch]),
  );

  const refresh = useCallback(() => void fetch(), [fetch]);

  return { count, refresh };
}
