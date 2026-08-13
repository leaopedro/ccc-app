import type { BoxCatalog, BoxView } from '@ccc/shared/box';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { updateBoxSelection } from '~/api/box';

import { loadDraft, saveDraft } from '~/screens/caixa/builder-offline';
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
          void saveDraft({
            boxId: box.id,
            items: latest.current.items,
            partners: latest.current.partners,
            dirty: false,
          });
        } catch {
          setWriteError(true);
        }
      } while (pending.current);
    } finally {
      inFlight.current = false;
    }
  }, [box.id]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void send();
    }, DEBOUNCE_MS);
  }, [send]);

  // Persist the in-progress selection as dirty so a failed write / app kill
  // can be resumed and resent on the next builder mount.
  const persistDirty = useCallback(
    (nextItems: SelectionMap, nextPartners: SelectionMap) => {
      void saveDraft({ boxId: box.id, items: nextItems, partners: nextPartners, dirty: true });
    },
    [box.id],
  );

  const setItemQty = useCallback(
    (id: string, qty: number) => {
      setItems((prev) => {
        const next = { ...prev, [id]: Math.max(0, qty) };
        persistDirty(next, latest.current.partners);
        return next;
      });
      schedule();
    },
    [schedule, persistDirty],
  );

  const setPartnerQty = useCallback(
    (id: string, qty: number) => {
      setPartners((prev) => {
        const next = { ...prev, [id]: Math.max(0, qty) };
        persistDirty(latest.current.items, next);
        return next;
      });
      schedule();
    },
    [schedule, persistDirty],
  );

  // Flush on unmount — never cancel silently.
  useEffect(() => {
    return () => {
      if (timer.current) void send();
    };
  }, [send]);

  // On mount, if a dirty draft for THIS box survived (failed write / app
  // kill), seed from it and resend. Runs once; the debounce/flush path owns
  // the rest of the write serialization.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void (async () => {
      const draft = await loadDraft(box.id);
      if (!draft || !draft.dirty) return;
      setItems(draft.items);
      setPartners(draft.partners);
      latest.current = { items: draft.items, partners: draft.partners };
      void send();
    })();
  }, [box.id, send]);

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
