import { useCallback, useEffect, useRef, useState } from 'react';

import { getBox } from '~/api/box';
import { boxPayOutcome } from '~/screens/caixa/pay-result';

type PollStatus = 'polling' | 'paid' | 'closed_budget_only' | 'expired' | 'error';

const BASE_INTERVAL_MS = 3000;
const BACKOFF_AFTER_MS = 30_000;
const MAX_INTERVAL_MS = 15_000;

export function useBoxPaymentPoll({
  expiresAt,
  enabled = true,
}: {
  expiresAt: string;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<PollStatus>('polling');
  const [retryCount, setRetryCount] = useState(0);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  const getInterval = useCallback(() => {
    const elapsed = Date.now() - startedAt.current;
    if (elapsed < BACKOFF_AFTER_MS) return BASE_INTERVAL_MS;
    const factor = Math.min(Math.floor((elapsed - BACKOFF_AFTER_MS) / 10_000) + 1, 4);
    return Math.min(BASE_INTERVAL_MS * Math.pow(1.5, factor), MAX_INTERVAL_MS);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    activeRef.current = true;
    startedAt.current = Date.now();

    const poll = async () => {
      if (!activeRef.current) return;
      if (new Date(expiresAt).getTime() <= Date.now()) {
        setStatus('expired');
        return;
      }
      try {
        const box = await getBox();
        if (!activeRef.current) return;
        const outcome = boxPayOutcome(box);
        if (outcome === 'paid') return setStatus('paid');
        if (outcome === 'closed_budget_only') return setStatus('closed_budget_only');
        timerRef.current = setTimeout(() => void poll(), getInterval());
      } catch {
        if (activeRef.current) setStatus('error');
      }
    };

    void poll();
    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [expiresAt, enabled, getInterval, retryCount]);

  const retry = useCallback(() => {
    setStatus('polling');
    startedAt.current = Date.now();
    setRetryCount((c) => c + 1);
  }, []);

  return { status, retry };
}
