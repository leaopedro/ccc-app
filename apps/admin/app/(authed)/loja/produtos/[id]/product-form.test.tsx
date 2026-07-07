import type { AdminProductType, AdminStoreProductDetail } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/store-actions', () => ({
  archiveProductAction: vi.fn(),
  updateProductAction: vi.fn(),
}));

import { ProductForm } from './product-form';

const productTypes: AdminProductType[] = [
  {
    id: 'pt_1',
    name: 'Camisetas',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    productCount: 1,
  },
  {
    id: 'pt_garage',
    name: 'garage_spot',
    sortOrder: 99,
    createdAt: '2026-01-01T00:00:00.000Z',
    productCount: 1,
  },
];

const baseProduct: AdminStoreProductDetail = {
  id: 'prod_1',
  slug: 'camiseta-jdm',
  title: 'Camiseta JDM',
  description: 'Algodão pima',
  productTypeId: 'pt_1',
  productTypeName: 'Camisetas',
  basePriceCents: 9900,
  currency: 'BRL',
  status: 'draft',
  virtual: false,
  visibleInStore: true,
  allowPickup: false,
  allowShip: false,
  shippingFeeCents: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  photos: [],
};

const garageSingleton: AdminStoreProductDetail = {
  ...baseProduct,
  id: 'prod_garage',
  slug: 'garage-spot',
  title: 'Vaga de Garagem Adicional',
  productTypeId: 'pt_garage',
  productTypeName: 'garage_spot',
  basePriceCents: 5000,
  status: 'active',
  virtual: true,
  visibleInStore: false,
};

// Archived singleton: used to verify Reativar is hidden even when the product is
// archived. A non-singleton archived product would normally show Reativar; the
// singleton must never show it.
const garageSingletonArchived: AdminStoreProductDetail = {
  ...garageSingleton,
  status: 'archived',
};

describe('ProductForm — non-virtual product', () => {
  it('renders the fulfillment fieldset', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('Modo de entrega');
    expect(html).toContain('Retirada no evento');
    expect(html).toContain('Envio');
  });

  it('renders the productTypeId select (editable)', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('name="productTypeId"');
  });

  it('renders the photo-required helper text when status is draft and no photos', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('Adicione pelo menos uma foto para ativar o produto.');
  });

  it('renders the Arquivar button for a draft non-singleton product', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('Arquivar');
  });

  it('does NOT render the system-attributes fieldset', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).not.toContain('Atributos do sistema');
  });
});

describe('ProductForm — virtual product', () => {
  it('does NOT render the fulfillment fieldset or hidden inputs', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('Modo de entrega');
    expect(html).not.toContain('Retirada no evento');
    expect(html).not.toContain('name="allowPickup"');
    expect(html).not.toContain('name="allowShip"');
    expect(html).not.toContain('name="shippingFeeCents"');
  });

  it('does NOT render the photo-required helper text', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('Adicione pelo menos uma foto para ativar o produto.');
    expect(html).not.toContain('Adicione pelo menos uma foto antes de ativar.');
  });

  it('still renders the price editor for the singleton', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).toContain('name="basePriceCents"');
  });

  it('hides the status select for the singleton (read-only label)', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('name="status"');
    expect(html).toContain('Status gerenciado pelo sistema.');
  });

  it('renders the status select for a non-singleton virtual product', () => {
    const nonSingletonVirtual: AdminStoreProductDetail = {
      ...baseProduct,
      id: 'prod_virt',
      slug: 'algum-virtual',
      virtual: true,
      productTypeId: 'pt_1',
      productTypeName: 'Camisetas',
    };
    const html = renderToStaticMarkup(
      <ProductForm product={nonSingletonVirtual} productTypes={productTypes} />,
    );
    expect(html).toContain('name="status"');
    expect(html).not.toContain('Status gerenciado pelo sistema.');
  });

  it('renders productType as read-only (no select, no name="productTypeId")', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('name="productTypeId"');
    expect(html).toContain('Tipo gerenciado pelo sistema.');
    expect(html).toContain('garage_spot');
  });

  it('renders read-only virtual + visibleInStore flags', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).toContain('Atributos do sistema');
    expect(html).toContain('Produto virtual');
    expect(html).toContain('Visível na loja');
    expect(html).toContain('aria-readonly="true"');
  });

  it('hides the Arquivar button for the garage-spot singleton (status=active)', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('>Arquivar<');
  });

  it('hides the Reativar button for the garage-spot singleton (status=archived)', () => {
    // status=archived means the ternary would render Reativar for a normal
    // product. For the singleton it must still be absent.
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingletonArchived} productTypes={productTypes} />,
    );
    expect(html).not.toContain('>Reativar<');
    expect(html).not.toContain('>Arquivar<');
  });
});
