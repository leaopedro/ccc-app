import type { PresaleCampaign, PresaleProduct } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Achado P1 (page-findings.md): o FAQ morava DENTRO do checkout, entre o
// consentimento e o seletor de pagamento — uma interrupção editorial antes
// de o comprador conseguir pagar. Este teste não mocka CasaInBoxCheckout (ao
// contrário de __tests__/page.test.tsx): precisa do HTML real dos dois
// componentes para comparar a posição de um contra o outro.
const { fetchPresaleCampaignMock, fetchPresaleProductsMock } = vi.hoisted(() => ({
  fetchPresaleCampaignMock: vi.fn(),
  fetchPresaleProductsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('~/lib/presale-api', () => ({
  fetchPresaleCampaign: fetchPresaleCampaignMock,
  fetchPresaleProducts: fetchPresaleProductsMock,
}));

import CasaInBoxPage from '../page';

import { presaleCopy } from '~/copy/presale';

const campaign: PresaleCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande São Paulo',
  pickupAddress: 'Pocket CASA, Rua Augusta 123',
  pickupHours: 'seg a sex, 9h às 18h',
  firstBatchLabel: '1º lote',
};

// Slugs precisam estar na allowlist de components/presale/selection.ts
// (classifyTier) — um slug desconhecido lança e derrubaria o teste.
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

describe('CasaInBoxPage — ordem do FAQ', () => {
  it('renderiza o FAQ depois do botão de pagar, não no meio do checkout', async () => {
    fetchPresaleCampaignMock.mockResolvedValueOnce(campaign);
    fetchPresaleProductsMock.mockResolvedValueOnce({ items: [basicProduct] });

    const html = renderToStaticMarkup(await CasaInBoxPage());

    const payButtonIndex = html.indexOf(presaleCopy.checkout.submitCta);
    const faqIndex = html.indexOf(presaleCopy.faq.title);

    expect(payButtonIndex).toBeGreaterThan(-1);
    expect(faqIndex).toBeGreaterThan(-1);
    expect(faqIndex).toBeGreaterThan(payButtonIndex);
  });
});
