// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBoxCatalog } = vi.hoisted(() => ({ getBoxCatalog: vi.fn() }));
vi.mock('~/api/box', () => ({ getBoxCatalog: () => getBoxCatalog() }));

import { useBoxCatalog } from './useBoxCatalog';

let snap: ReturnType<typeof useBoxCatalog>;
function Probe() {
  snap = useBoxCatalog();
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => getBoxCatalog.mockReset());

describe('useBoxCatalog', () => {
  it('loads the catalog', async () => {
    getBoxCatalog.mockResolvedValueOnce({ categories: [], items: [], partners: [] });
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap.loading).toBe(false);
    expect(snap.catalog).toEqual({ categories: [], items: [], partners: [] });
    expect(snap.error).toBe(false);
  });

  it('sets error on failure', async () => {
    getBoxCatalog.mockRejectedValueOnce(new Error('net'));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap.error).toBe(true);
    expect(snap.catalog).toBeNull();
  });
});
