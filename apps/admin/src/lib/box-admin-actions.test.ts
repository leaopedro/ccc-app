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
import { createPartnerAction, createPartnerModuleAction } from './box-admin-actions';

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

describe('box-admin-actions partners', () => {
  beforeEach(() => {
    createBoxPartner.mockReset().mockResolvedValue({});
    createBoxPartnerModule.mockReset().mockResolvedValue({});
  });

  it('creates a partner from form data', async () => {
    const fd = new FormData();
    fd.set('slug', 'oficina-x');
    fd.set('name', 'Oficina X');
    fd.set('active', 'on');
    const result = await createPartnerAction({ error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(createBoxPartner).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'oficina-x', name: 'Oficina X', active: true }),
    );
  });

  it('creates a module bound to a partner id', async () => {
    const fd = new FormData();
    fd.set('name', 'Kit');
    fd.set('priceCents', '9900');
    fd.set('active', 'on');
    const result = await createPartnerModuleAction('p1', { error: null }, fd);
    expect(result).toEqual({ error: null });
    expect(createBoxPartnerModule).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ name: 'Kit', priceCents: 9900 }),
    );
  });
});
