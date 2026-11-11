import type { PresaleProduct } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TierCard } from '../TierCard';

import { fmtCurrencyCents } from '~/lib/format';

const basicProduct: PresaleProduct = {
  id: 'p-basic',
  slug: 'casa-in-box-basic',
  title: 'Casa In Box Basic',
  shortDescription: 'A caixa de entrada da pré-venda.',
  coverImageUrl: null,
  canShip: true,
  canPickup: true,
  variants: [
    {
      id: 'v-basic',
      title: 'Único',
      priceCents: 9900,
      currency: 'BRL',
      stockOnHand: 10,
      isActive: true,
    },
  ],
};

const premiumProduct: PresaleProduct = {
  id: 'p-premium',
  slug: 'casa-in-box-premium',
  title: 'Casa In Box Premium',
  shortDescription: null,
  coverImageUrl: null,
  canShip: true,
  canPickup: true,
  variants: [
    { id: 'v-p', title: 'P', priceCents: 15900, currency: 'BRL', stockOnHand: 5, isActive: true },
    { id: 'v-m', title: 'M', priceCents: 15900, currency: 'BRL', stockOnHand: 5, isActive: true },
  ],
};

describe('TierCard', () => {
  it('renders the title and price from the product, not hardcoded', () => {
    const html = renderToStaticMarkup(
      <TierCard
        product={basicProduct}
        selectedVariantId={basicProduct.variants[0]!.id}
        isSelected={false}
        onSelectVariant={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain('Casa In Box Basic');
    expect(html).toContain(fmtCurrencyCents(9900, 'BRL'));
  });

  it('does NOT render a size selector for a single-variant product', () => {
    const html = renderToStaticMarkup(
      <TierCard
        product={basicProduct}
        selectedVariantId={basicProduct.variants[0]!.id}
        isSelected={false}
        onSelectVariant={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(html).not.toContain('<select');
  });

  it('renders a size selector for a multi-variant product, with sizes from its variants', () => {
    const html = renderToStaticMarkup(
      <TierCard
        product={premiumProduct}
        selectedVariantId={premiumProduct.variants[0]!.id}
        isSelected={false}
        onSelectVariant={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain('<select');
    expect(html).toContain('>P<');
    expect(html).toContain('>M<');
  });
});
