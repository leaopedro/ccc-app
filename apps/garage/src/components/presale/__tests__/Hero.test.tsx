import type { PresaleCampaign } from '@ccc/shared/presale';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Hero } from '../Hero';

import { presaleCopy } from '~/copy/presale';

const campaign: PresaleCampaign = {
  enabled: true,
  shippingFeeCents: 1990,
  deliveryAreaLabel: 'Grande São Paulo',
  pickupAddress: 'Pocket CASA, Rua Augusta 123',
  pickupHours: 'seg a sex, 9h às 18h',
  firstBatchLabel: '1º lote',
};

describe('Hero', () => {
  it('renders title, subtitle and CTA from copy', () => {
    const html = renderToStaticMarkup(<Hero campaign={campaign} />);
    expect(html).toContain(presaleCopy.hero.title);
    expect(html).toContain(presaleCopy.hero.subtitle);
    expect(html).toContain(presaleCopy.hero.cta);
  });

  it('identifies the photographed composition as illustrative', () => {
    const html = renderToStaticMarkup(<Hero campaign={campaign} />);
    expect(html).toContain(presaleCopy.hero.photoCaption);
  });

  it('degrades without a gap when there is no first batch label', () => {
    const noBatch: PresaleCampaign = { ...campaign, firstBatchLabel: null };
    expect(() => renderToStaticMarkup(<Hero campaign={noBatch} />)).not.toThrow();
  });
});
