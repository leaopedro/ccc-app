import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  },
}));

import { clearDraft, loadDraft, saveDraft } from './builder-offline';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('builder-offline', () => {
  it('round-trips a dirty draft for the same box', async () => {
    await saveDraft({ boxId: 'b1', items: { i1: 2 }, partners: { m1: 1 }, dirty: true });
    const draft = await loadDraft('b1');
    expect(draft).toMatchObject({
      boxId: 'b1',
      dirty: true,
      items: { i1: 2 },
      partners: { m1: 1 },
    });
  });

  it('returns null for a different box id (stale cycle)', async () => {
    await saveDraft({ boxId: 'b1', items: { i1: 2 }, partners: {}, dirty: true });
    expect(await loadDraft('b2')).toBeNull();
  });

  it('clears the draft', async () => {
    await saveDraft({ boxId: 'b1', items: { i1: 1 }, partners: {}, dirty: true });
    await clearDraft('b1');
    expect(await loadDraft('b1')).toBeNull();
  });
});
