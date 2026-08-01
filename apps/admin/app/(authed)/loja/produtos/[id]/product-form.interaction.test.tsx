// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminProductType, AdminStoreProductDetail } from '@ccc/shared/admin';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateProductMock, archiveProductMock } = vi.hoisted(() => ({
  updateProductMock: vi.fn(() => Promise.resolve({ error: null })),
  archiveProductMock: vi.fn(() => Promise.resolve({ error: null })),
}));

vi.mock('~/lib/store-actions', () => ({
  updateProductAction: updateProductMock,
  archiveProductAction: archiveProductMock,
}));

import { ProductForm } from './product-form';

const productTypes: AdminProductType[] = [
  {
    id: 'pt_garage',
    name: 'garage_spot',
    sortOrder: 99,
    createdAt: '2026-01-01T00:00:00.000Z',
    productCount: 1,
  },
];

const virtualProduct: AdminStoreProductDetail = {
  id: 'prod_garage',
  slug: 'garage-spot',
  title: 'Vaga de Garagem Adicional',
  description: 'Vaga extra.',
  productTypeId: 'pt_garage',
  productTypeName: 'garage_spot',
  basePriceCents: 5000,
  currency: 'BRL',
  status: 'draft',
  virtual: true,
  visibleInStore: false,
  allowPickup: false,
  allowShip: false,
  shippingFeeCents: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  photos: [],
};

// A virtual product that is NOT a singleton — exercises the form when
// status select is rendered (singleton path replaces select with a read-only
// label, so status interactions belong here).
const virtualNonSingleton: AdminStoreProductDetail = {
  ...virtualProduct,
  id: 'prod_virtual_other',
  slug: 'algum-virtual',
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  updateProductMock.mockClear();
  archiveProductMock.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('ProductForm interaction — virtual product', () => {
  it('does not disable the active option even when there are no photos (non-singleton virtual)', () => {
    act(() => {
      root.render(<ProductForm product={virtualNonSingleton} productTypes={productTypes} />);
    });
    const select = container.querySelector('select[name="status"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const activeOption = Array.from(select.options).find((o) => o.value === 'active');
    expect(activeOption?.disabled).toBe(false);
  });

  it('submits without fulfillment fields when the form is submitted (non-singleton virtual)', () => {
    act(() => {
      root.render(<ProductForm product={virtualNonSingleton} productTypes={productTypes} />);
    });
    const form = container.querySelector('form') as HTMLFormElement;
    const fd = new FormData(form);
    expect(fd.has('allowPickup')).toBe(false);
    expect(fd.has('allowShip')).toBe(false);
    expect(fd.has('shippingFeeCents')).toBe(false);
    // Sanity: price is still in the submission.
    expect(fd.get('basePriceCents')).toBe('5000');
    // productTypeId is read-only for virtual products, so it must NOT be a
    // posted form field. The server keeps the seeded value.
    expect(fd.has('productTypeId')).toBe(false);
    const statusSelect = container.querySelector('select[name="status"]') as HTMLSelectElement;
    expect(statusSelect.value).toBe('draft');
  });

  it('hides the status select for the garage-spot singleton', () => {
    act(() => {
      root.render(<ProductForm product={virtualProduct} productTypes={productTypes} />);
    });
    const statusSelect = container.querySelector('select[name="status"]');
    expect(statusSelect).toBeNull();
    const form = container.querySelector('form') as HTMLFormElement;
    const fd = new FormData(form);
    expect(fd.has('status')).toBe(false);
  });

  it('hides Arquivar and Reativar buttons for the garage-spot singleton', () => {
    act(() => {
      root.render(<ProductForm product={virtualProduct} productTypes={productTypes} />);
    });
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    );
    expect(buttons.some((t) => t.trim() === 'Arquivar')).toBe(false);
    expect(buttons.some((t) => t.trim() === 'Reativar')).toBe(false);
  });

  it('marks the virtual and visibleInStore checkboxes as readOnly', () => {
    act(() => {
      root.render(<ProductForm product={virtualProduct} productTypes={productTypes} />);
    });
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    for (const cb of checkboxes) {
      expect(cb.readOnly).toBe(true);
    }
  });
});
