import { describe, expect, it } from 'vitest';

import { selectResumeKind } from './resume-selector';

describe('selectResumeKind', () => {
  it('returns pix for AbacatePay orders regardless of platform or stored URL', () => {
    expect(
      selectResumeKind(
        { provider: 'abacatepay' },
        { platform: 'web', hasStoredCheckoutUrl: false, stripeAvailable: false },
      ),
    ).toBe('pix');
    expect(
      selectResumeKind(
        { provider: 'abacatepay' },
        { platform: 'native', hasStoredCheckoutUrl: false, stripeAvailable: true },
      ),
    ).toBe('pix');
  });

  it('returns web for web Stripe order when a stored URL exists (canonical cart order)', () => {
    expect(
      selectResumeKind(
        { provider: 'stripe' },
        { platform: 'web', hasStoredCheckoutUrl: true, stripeAvailable: false },
      ),
    ).toBe('web');
  });

  it('returns none for web Stripe sibling orders without a stored URL', () => {
    expect(
      selectResumeKind(
        { provider: 'stripe' },
        { platform: 'web', hasStoredCheckoutUrl: false, stripeAvailable: false },
      ),
    ).toBe('none');
  });

  it('returns native-stripe for native Stripe order when SDK is available', () => {
    expect(
      selectResumeKind(
        { provider: 'stripe' },
        { platform: 'native', hasStoredCheckoutUrl: false, stripeAvailable: true },
      ),
    ).toBe('native-stripe');
  });

  it('returns none for native Stripe order when SDK is unavailable', () => {
    expect(
      selectResumeKind(
        { provider: 'stripe' },
        { platform: 'native', hasStoredCheckoutUrl: false, stripeAvailable: false },
      ),
    ).toBe('none');
  });
});
