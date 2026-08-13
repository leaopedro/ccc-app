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
  const prices = useMemo(() => buildPriceIndex(box, catalog), [box, catalog]);

  const [items, setItems] = useState<SelectionMap>(seed.items);
  const [partners, setPartners] = useState<SelectionMap>(seed.partners);
  const [writeError, setWriteError] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest selection, read at flush time (avoids stale closures).
  const latest = useRef({ items, partners });
  latest.current = { items, partners };

  const send = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setWriteError(false);
    try {
      await updateBoxSelection(toSelectionUpdate(latest.current.items, latest.current.partners));
    } catch {
      setWriteError(true);
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
    () => computeOptimisticTotals(items, partners, prices, box.budgetCents),
    [items, partners, prices, box.budgetCents],
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
