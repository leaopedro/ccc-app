import type { BoxCatalog, BoxView } from '@ccc/shared/box';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { updateBoxSelection } from '~/api/box';

import {
  buildPriceIndex,
  computeOptimisticTotals,
  seedSelection,
  toSelectionUpdate,
  type OptimisticTotals,
  type SelectionMap,
} from '~/screens/caixa/builder-selection';

const DEBOUNCE_MS = 600;

type UseBoxBuilder = {
  items: SelectionMap;
  partners: SelectionMap;
  totals: OptimisticTotals;
  setItemQty: (id: string, qty: number) => void;
  setPartnerQty: (id: string, qty: number) => void;
  flush: () => Promise<void>;
  writeError: boolean;
  retry: () => Promise<void>;
};

export function useBoxBuilder(box: BoxView, catalog: BoxCatalog): UseBoxBuilder {
  const seed = useMemo(() => seedSelection(box), [box]);

  const [items, setItems] = useState<SelectionMap>(seed.items);
  const [partners, setPartners] = useState<SelectionMap>(seed.partners);
  const [writeError, setWriteError] = useState(false);
  // Server is the source of truth for totals; reconciled from each PUT response.
  const [serverBox, setServerBox] = useState<BoxView>(box);

  const prices = useMemo(() => buildPriceIndex(serverBox, catalog), [serverBox, catalog]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest selection, read at flush time (avoids stale closures).
  const latest = useRef({ items, partners });
  latest.current = { items, partners };
  // Serialize writes: at most one PUT in flight. Without this, the debounce
  // timer and a blur/flush can fire two concurrent PUTs; the server serializes
  // them by lock-acquisition order, not send order, so a delayed older request
  // could commit AFTER a newer one and leave the DB with a stale selection. A
  // call made while a send is in flight sets `pending`; the in-flight send then
  // loops and re-sends the latest selection, so the last write always wins on
  // the server too.
  const inFlight = useRef(false);
  const pending = useRef(false);

  const send = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        pending.current = false;
        setWriteError(false);
        try {
          const result = await updateBoxSelection(
            toSelectionUpdate(latest.current.items, latest.current.partners),
          );
          setWriteError(false);
          setServerBox(result);
        } catch {
          setWriteError(true);
        }
      } while (pending.current);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void send();
    }, DEBOUNCE_MS);
  }, [send]);

  const setItemQty = useCallback(
    (id: string, qty: number) => {
      setItems((prev) => ({ ...prev, [id]: Math.max(0, qty) }));
      schedule();
    },
    [schedule],
  );

  const setPartnerQty = useCallback(
    (id: string, qty: number) => {
      setPartners((prev) => ({ ...prev, [id]: Math.max(0, qty) }));
      schedule();
    },
    [schedule],
  );

  // Flush on unmount — never cancel silently.
  useEffect(() => {
    return () => {
      if (timer.current) void send();
    };
  }, [send]);

  const totals = useMemo(
    () => computeOptimisticTotals(items, partners, prices, serverBox.budgetCents),
    [items, partners, prices, serverBox.budgetCents],
  );

  return {
    items,
    partners,
    totals,
    setItemQty,
    setPartnerQty,
    flush: send,
    writeError,
    retry: send,
  };
}
