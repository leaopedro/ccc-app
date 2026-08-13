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

  it('flush sends immediately', async () => {
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
});
