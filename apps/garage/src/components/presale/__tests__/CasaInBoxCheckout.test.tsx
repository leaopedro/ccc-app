import type { PresaleCampaign, PresaleProduct } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CasaInBoxCheckout } from '../CasaInBoxCheckout';

const campaign: PresaleCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande São Paulo',
  pickupAddress: 'Pocket CASA, Rua Augusta 123',
  pickupHours: 'seg a sex, 9h às 18h',
  firstBatchLabel: '1º lote',
};

const basicProduct: PresaleProduct = {
  id: 'p-basic',
  slug: 'casa-in-box-basic',
  title: 'Casa In Box Basic',
  shortDescription: null,
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

describe('CasaInBoxCheckout', () => {
  it('renders both tier cards with title and price from the products given', () => {
    const html = renderToStaticMarkup(
      <CasaInBoxCheckout campaign={campaign} products={[basicProduct, premiumProduct]} />,
    );
    expect(html).toContain('Casa In Box Basic');
    expect(html).toContain('Casa In Box Premium');
  });

  it('does not throw and keeps the page standing with an empty catalog', () => {
    expect(() =>
      renderToStaticMarkup(<CasaInBoxCheckout campaign={campaign} products={[]} />),
    ).not.toThrow();
  });

  it('starts with the consent checkbox unchecked and the pay button disabled', () => {
    const html = renderToStaticMarkup(
      <CasaInBoxCheckout campaign={campaign} products={[basicProduct, premiumProduct]} />,
    );
    const checkboxMatch = html.match(/<input[^>]*type="checkbox"[^>]*>/);
    expect(checkboxMatch).not.toBeNull();
    expect(checkboxMatch![0]).not.toContain('checked');

    const buttonMatch = html.match(/<button[^>]*type="submit"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).toContain('disabled');
  });

  it('links the consent text to /privacidade and /termos', () => {
    const html = renderToStaticMarkup(
      <CasaInBoxCheckout campaign={campaign} products={[basicProduct, premiumProduct]} />,
    );
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain('href="/termos"');
  });
});
