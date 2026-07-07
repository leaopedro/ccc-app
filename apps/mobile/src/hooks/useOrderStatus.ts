import type { GetOrderResponse } from '@jdm/shared/orders';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getOrder } from '~/api/orders';

type OrderPollStatus = 'polling' | 'paid' | 'expired' | 'failed' | 'error';

type UseOrderStatusOptions = {
  orderId: string;
  expiresAt: string;
  enabled?: boolean;
};

const BASE_INTERVAL_MS = 3000;
const BACKOFF_AFTER_MS = 30_000;
const MAX_INTERVAL_MS = 15_000;

export function useOrderStatus({ orderId, expiresAt, enabled = true }: UseOrderStatusOptions) {
  const [status, setStatus] = useState<OrderPollStatus>('polling');
  const [ticketId, setTicketId] = useState<string | undefined>();
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
        const order: GetOrderResponse = await getOrder(orderId);
        if (!activeRef.current) return;

        if (order.status === 'paid') {
          setTicketId(order.ticketId);
          setStatus('paid');
          return;
        }
        if (order.status === 'expired') {
          setStatus('expired');
          return;
        }
        if (order.status === 'failed' || order.status === 'refunded') {
          setStatus('failed');
          return;
        }

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
  }, [orderId, expiresAt, enabled, getInterval, retryCount]);

  const retry = useCallback(() => {
    setStatus('polling');
    startedAt.current = Date.now();
    setRetryCount((c) => c + 1);
  }, []);

  return { status, ticketId, retry };
}
