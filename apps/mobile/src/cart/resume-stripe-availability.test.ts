import { describe, expect, it } from 'vitest';

import { stripeResumeAvailable } from './resume-stripe-availability';

describe('stripeResumeAvailable', () => {
  // Canon §F8.16 used to force `false` here on iOS, so an iOS member with a
  // pending card order had no way at all to pay it — kind === 'none', no button.
  it('is available on iOS when a publishable key is configured', () => {
    expect(stripeResumeAvailable({ platform: 'ios', hasPublishableKey: true })).toBe(true);
  });

  it('is available on android', () => {
    expect(stripeResumeAvailable({ platform: 'android', hasPublishableKey: true })).toBe(true);
  });

  it('is unavailable without a key', () => {
    expect(stripeResumeAvailable({ platform: 'ios', hasPublishableKey: false })).toBe(false);
  });
});
