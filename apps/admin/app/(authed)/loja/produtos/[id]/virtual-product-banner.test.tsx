import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VirtualProductBanner } from './virtual-product-banner';

describe('VirtualProductBanner', () => {
  it('renders the title and the explanatory body copy', () => {
    const html = renderToStaticMarkup(<VirtualProductBanner />);
    expect(html).toContain('Produto virtual');
    expect(html).toContain('Produto virtual — sem estoque ou entrega.');
  });

  it('explains that the product is fulfilled by webhook and cannot be archived via UI', () => {
    const html = renderToStaticMarkup(<VirtualProductBanner />);
    expect(html).toContain('webhook');
    expect(html).toContain('arquivado');
  });

  it('exposes a stable test hook via data-testid', () => {
    const html = renderToStaticMarkup(<VirtualProductBanner />);
    expect(html).toContain('data-testid="virtual-product-banner"');
  });

  it('renders the linked product type when provided', () => {
    const html = renderToStaticMarkup(<VirtualProductBanner productTypeName="garage_spot" />);
    expect(html).toContain('Tipo vinculado');
    expect(html).toContain('garage_spot');
  });
});
