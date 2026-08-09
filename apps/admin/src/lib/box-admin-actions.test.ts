import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// All box admin-api fns mocked here once. Later tasks reference these consts.
const createBoxCatalogItem = vi.fn<(input: unknown) => Promise<unknown>>();
const createBoxPartner = vi.fn<(input: unknown) => Promise<unknown>>();
const createBoxPartnerModule = vi.fn<(id: string, input: unknown) => Promise<unknown>>();
const updateBoxSettings = vi.fn<(input: unknown) => Promise<unknown>>();

vi.mock('./admin-api', () => ({
  createBoxCatalogItem: (input: unknown) => createBoxCatalogItem(input),
  updateBoxCatalogItem: vi.fn(),
  deleteBoxCatalogItem: vi.fn(),
  createBoxPartner: (input: unknown) => createBoxPartner(input),
  updateBoxPartner: vi.fn(),
  deleteBoxPartner: vi.fn(),
  createBoxPartnerModule: (id: string, input: unknown) => createBoxPartnerModule(id, input),
  updateBoxPartnerModule: vi.fn(),
  deleteBoxPartnerModule: vi.fn(),
  getBoxPartners: vi.fn(),
  getBoxSettings: vi.fn(),
  updateBoxSettings: (input: unknown) => updateBoxSettings(input),
}));

import { createBoxCatalogItemAction } from './box-admin-actions';

describe('box-admin-actions catalog', () => {
  beforeEach(() => {
    createBoxCatalogItem.mockReset().mockResolvedValue({});
  });

  it('parses form data and forwards to the api', async () => {
    const fd = new FormData();
    fd.set('slug', 'cafe-500g');
    fd.set('title', 'Cafe 500g');
    fd.set('description', 'Cafe especial');
    fd.set('priceCents', '4500');
    fd.set('category', 'bebidas');
    fd.set('active', 'on');
    fd.set('sortOrder', '2');

    const result = await createBoxCatalogItemAction({ error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(createBoxCatalogItem).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'cafe-500g', priceCents: 4500, active: true, sortOrder: 2 }),
    );
  });

  it('returns a validation error for a bad price', async () => {
    const fd = new FormData();
    fd.set('slug', 'x');
    fd.set('title', 'X');
    fd.set('description', 'x');
    fd.set('priceCents', '-1');
    fd.set('category', 'c');
    const result = await createBoxCatalogItemAction({ error: null }, fd);
    expect(result.error).not.toBeNull();
    expect(createBoxCatalogItem).not.toHaveBeenCalled();
  });
});
