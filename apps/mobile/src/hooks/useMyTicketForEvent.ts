import type { MyTicket, MyTicketExtra } from '@jdm/shared/tickets';
import { useEffect, useState } from 'react';

import { listMyTickets } from '~/api/tickets';

interface Result {
  ticket: MyTicket | null;
  ownedExtraIds: Set<string>;
  loading: boolean;
}

export function useMyTicketForEvent(eventId: string | undefined): Result {
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [ownedExtraIds, setOwnedExtraIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { items } = await listMyTickets();
        const match = items.find((t: MyTicket) => t.event.id === eventId && t.status === 'valid');
        if (!cancelled) {
          setTicket(match ?? null);
          setOwnedExtraIds(new Set(match?.extras.map((e: MyTicketExtra) => e.extraId) ?? []));
        }
      } catch {
        // Network error — treat as no ticket
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return { ticket, ownedExtraIds, loading };
}
