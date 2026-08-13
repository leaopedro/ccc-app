// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateBoxSelection = vi.fn();
vi.mock('~/api/box', () => ({ updateBoxSelection: (p: unknown) => updateBoxSelection(p) }));

const { loadDraft: loadDraftMock, saveDraft: saveDraftMock } = vi.hoisted(() => ({
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('~/screens/caixa/builder-offline', () => ({
  loadDraft: (id: string) => loadDraftMock(id),
  saveDraft: (input: unknown) => saveDraftMock(input),
  clearDraft: vi.fn(),
}));

import { useBoxBuilder } from './useBoxBuilder';

const boxId = 'box-1';
const box = {
  id: boxId,
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
  loadDraftMock.mockReset().mockResolvedValue(null);
  saveDraftMock.mockReset();
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
    let flush1!: Promise<boolean>;
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

  it('does not mark the draft clean when a newer edit arrives mid-flight', async () => {
    // Hold the PUT open so a newer edit can land while it is still in flight.
    let resolveFirst!: (v: unknown) => void;
    updateBoxSelection.mockReset();
    updateBoxSelection.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));

    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });

    let flush1!: Promise<boolean>;
    await act(async () => {
      api.setItemQty('a', 1);
      flush1 = api.flush();
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);

    // A newer edit arrives while the PUT sent above is still pending.
    await act(async () => {
      api.setItemQty('a', 3);
    });

    await act(async () => {
      resolveFirst(box);
      await flush1;
    });

    // The PUT that just succeeded was for quantity 1 — a snapshot taken
    // before the newer edit (quantity 3) landed. Since that newer edit was
    // never part of this PUT, the draft must NOT be marked clean at all: not
    // for the stale (quantity 1) selection that was actually sent, and not
    // for the newer (quantity 3) selection that was NOT sent.
    expect(saveDraftMock).not.toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
  });

  it('flush resolves false when the PUT fails and true when it succeeds', async () => {
    updateBoxSelection.mockReset().mockRejectedValueOnce(new Error('net')).mockResolvedValue(box);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    let firstOk: boolean | undefined;
    await act(async () => {
      firstOk = await api.flush();
    });
    let secondOk: boolean | undefined;
    await act(async () => {
      secondOk = await api.flush();
    });
    expect(firstOk).toBe(false);
    expect(secondOk).toBe(true);
  });

  it('does not clobber a newer edit with a draft that resolved after mount', async () => {
    // Hold loadDraft open so the user can edit before the draft resolves.
    let resolveLoad!: (v: unknown) => void;
    loadDraftMock.mockReset().mockImplementationOnce(() => new Promise((r) => (resolveLoad = r)));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    // User edits while loadDraft is still in flight.
    await act(async () => {
      api.setItemQty('a', 5);
    });
    // The older dirty draft (quantity 3) now resolves.
    await act(async () => {
      resolveLoad({ version: 1, boxId, savedAt: 'x', dirty: true, items: { a: 3 }, partners: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    // The user's edit stands; the stale draft was neither applied nor sent.
    expect(api.items.a).toBe(5);
    expect(updateBoxSelection).not.toHaveBeenCalledWith({
      items: [{ catalogItemId: 'a', quantity: 3 }],
      partnerItems: [],
    });
  });

  it('resends a dirty draft on mount', async () => {
    loadDraftMock.mockResolvedValueOnce({
      version: 1,
      boxId,
      savedAt: 'x',
      dirty: true,
      items: { a: 3 },
      partners: {},
    });
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      // Flush the microtask chain in the resend effect (await loadDraft(...)
      // then send()) — fake timers only govern setTimeout, not promises.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadDraftMock).toHaveBeenCalledWith(boxId);
    expect(updateBoxSelection).toHaveBeenCalledWith({
      items: [{ catalogItemId: 'a', quantity: 3 }],
      partnerItems: [],
    });
  });
});
