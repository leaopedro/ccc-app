import type { PresaleCampaign } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Faq } from '../Faq';

import { presaleCopy } from '~/copy/presale';

const campaign: PresaleCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande São Paulo',
  pickupAddress: 'Pocket CASA, Rua Augusta 123',
  pickupHours: 'seg a sex, 9h às 18h',
  firstBatchLabel: '1º lote',
};

describe('Faq', () => {
  it('renders the pickup question when pickupAddress is set', () => {
    const html = renderToStaticMarkup(<Faq campaign={campaign} />);
    expect(html).toContain('retirar');
  });

  it('omits the pickup question when the campaign has no pickupAddress', () => {
    const noPickup: PresaleCampaign = { ...campaign, pickupAddress: null };
    const html = renderToStaticMarkup(<Faq campaign={noPickup} />);
    expect(html).not.toContain('retirar');
  });

  // Achado P2: a resposta antiga só mencionava a Stripe, como se cartão
  // fosse o único meio de pagamento — falso desde que o Pix via AbacatePay
  // existe. Trava a regressão: a resposta tem que cobrir os dois provedores.
  it('explica o pagamento por cartão (Stripe) e por Pix (AbacatePay), não só cartão', () => {
    const html = renderToStaticMarkup(<Faq campaign={campaign} />);
    expect(html).toContain('Stripe');
    expect(html).toContain('AbacatePay');
    expect(html).toContain(
      presaleCopy.faq.items.find((item) => item.question === 'Como funciona o pagamento?')!.body,
    );
  });
});
