// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateBoxSelection = vi.fn();
vi.mock('~/api/box', () => ({ updateBoxSelection: (p: unknown) => updateBoxSelection(p) }));

import { useBoxBuilder } from './useBoxBuilder';

const box = {
  budgetCents: 45000,
  itemsTotalCents: 0,
  partnersTotalCents: 0,
  overflowCents: 0,
  items: [],
  partnerItems: [],
} as never;
const catalog = {
  categories: [],
  items: [
    {
      id: 'a',
      title: 'A',
      category: 'c',
      priceCents: 10000,
      imageUrl: null,
      maxPerCycle: null,
      soldOut: false,
    },
  ],
  partners: [],
} as never;

let api: ReturnType<typeof useBoxBuilder>;
function Probe() {
  api = useBoxBuilder(box, catalog);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  updateBoxSelection.mockReset().mockResolvedValue(box);
});
afterEach(() => vi.useRealTimers());

describe('useBoxBuilder', () => {
  it('debounces a single PUT after quiet period', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    await act(async () => {
      api.setItemQty('a', 2);
    });
    expect(updateBoxSelection).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);
    expect(updateBoxSelection).toHaveBeenCalledWith({
      items: [{ catalogItemId: 'a', quantity: 2 }],
      partnerItems: [],
    });
  });

  it('flush sends immediately and cancels the pending debounce timer', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    await act(async () => {
      await api.flush();
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);
    // The 600ms debounce scheduled by setItemQty must not fire a second PUT.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);
  });

  it('reconciles totals from the server response after the PUT settles', async () => {
    updateBoxSelection.mockResolvedValueOnce({
      budgetCents: 20000,
      itemsTotalCents: 0,
      partnersTotalCents: 0,
      overflowCents: 0,
      items: [{ catalogItemId: 'a', quantity: 2, unitPriceCents: 5000 }],
      partnerItems: [],
    } as never);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 2);
    });
    await act(async () => {
      await api.flush();
    });
    // Reconciled price index now prices item "a" at 5000 (from the server
    // response) against a 20000 budget, not the original 10000/45000.
    expect(api.totals.itemsTotalCents).toBe(10000);
    expect(api.totals.overflowCents).toBe(0);
  });

  it('sets writeError when the PUT rejects', async () => {
    updateBoxSelection.mockRejectedValueOnce(new Error('net'));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    await act(async () => {
      await api.flush();
    });
    expect(api.writeError).toBe(true);
  });

  it('serializes overlapping sends and the trailing send uses the latest selection', async () => {
    // Hold the first PUT open so a second send is requested while it is in flight.
    let resolveFirst!: (v: unknown) => void;
    updateBoxSelection.mockReset();
    updateBoxSelection
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValue(box);

    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });

    // First send is now in flight, awaiting the held promise.
    let flush1!: Promise<void>;
    await act(async () => {
      api.setItemQty('a', 1);
      flush1 = api.flush();
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);

    // A second flush while in flight must NOT start a concurrent PUT.
    await act(async () => {
      api.setItemQty('a', 3);
      void api.flush();
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);

    // Once the first resolves, the queued trailing send fires with the latest selection.
    await act(async () => {
      resolveFirst(box);
      await flush1;
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(2);
    expect(updateBoxSelection).toHaveBeenLastCalledWith({
      items: [{ catalogItemId: 'a', quantity: 3 }],
      partnerItems: [],
    });
  });
});
