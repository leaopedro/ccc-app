import { describe, expect, it } from 'vitest';

import { shouldMountStripeProvider } from '../stripe-provider-gate';

// Canon §F8.16 was superseded on 2026-08-29: the iOS bundle now pays through
// Stripe natively, because 3.1.3(e) puts physical goods and services consumed
// outside the app OUTSIDE in-app purchase. Mounting the provider is the
// precondition for every PaymentSheet in this plan.
describe('shouldMountStripeProvider', () => {
  it('mounts on iOS when a publishable key is present', () => {
    expect(shouldMountStripeProvider({ platform: 'ios', stripeKey: 'pk_live_x' })).toBe(true);
  });

  it('mounts on android and web too', () => {
    expect(shouldMountStripeProvider({ platform: 'android', stripeKey: 'pk_live_x' })).toBe(true);
    expect(shouldMountStripeProvider({ platform: 'web', stripeKey: 'pk_live_x' })).toBe(true);
  });

  it('does not mount without a key, on any platform', () => {
    expect(shouldMountStripeProvider({ platform: 'ios', stripeKey: '' })).toBe(false);
    expect(shouldMountStripeProvider({ platform: 'android', stripeKey: '' })).toBe(false);
  });
});
