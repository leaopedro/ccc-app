// @vitest-environment jsdom
// apps/mobile/src/hooks/useBoxHistory.test.tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const getBoxHistory = vi.fn();
vi.mock('../api/box', () => ({ getBoxHistory: () => getBoxHistory() }));

import { useBoxHistory } from './useBoxHistory';

let snap: { loading: boolean; error: boolean; entries: unknown } | undefined;
function Probe() {
  const s = useBoxHistory();
  snap = { loading: s.loading, error: s.error, entries: s.entries };
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useBoxHistory', () => {
  it('exposes the history entries on success', async () => {
    getBoxHistory.mockResolvedValue([{ id: 'h1', cycleKey: '2026-08' }]);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, error: false });
    expect(snap!.entries).toEqual([{ id: 'h1', cycleKey: '2026-08' }]);
  });

  it('returns an empty list when /me/boxes has no entries', async () => {
    getBoxHistory.mockResolvedValue([]);
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, error: false, entries: [] });
  });

  it('sets error on failure', async () => {
    getBoxHistory.mockRejectedValue(new Error('boom'));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, error: true, entries: [] });
  });
});
