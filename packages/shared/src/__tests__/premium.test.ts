import { describe, expect, it } from 'vitest';

import {
  premiumBillingPortalResponseSchema,
  premiumCheckoutPrecheckResponseSchema,
  premiumCheckoutRequestSchema,
  premiumCheckoutResponseSchema,
} from '../premium.js';

describe('premiumCheckoutRequestSchema', () => {
  it('accepts monthly cadence', () => {
    expect(premiumCheckoutRequestSchema.parse({ cadence: 'monthly' })).toEqual({
      cadence: 'monthly',
    });
  });
  it('accepts annual cadence', () => {
    expect(premiumCheckoutRequestSchema.parse({ cadence: 'annual' })).toEqual({
      cadence: 'annual',
    });
  });
  it('rejects unknown cadence', () => {
    expect(() => premiumCheckoutRequestSchema.parse({ cadence: 'weekly' })).toThrow();
  });
  it('rejects missing cadence', () => {
    expect(() => premiumCheckoutRequestSchema.parse({})).toThrow();
  });
});

describe('premiumCheckoutResponseSchema', () => {
  it('accepts valid url + sessionId', () => {
    const result = premiumCheckoutResponseSchema.parse({
      url: 'https://checkout.stripe.com/pay/cs_test_abc',
      sessionId: 'cs_test_abc',
    });
    expect(result.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
    expect(result.sessionId).toBe('cs_test_abc');
  });
});

describe('premiumCheckoutPrecheckResponseSchema', () => {
  it('accepts available=true with no other fields', () => {
    const result = premiumCheckoutPrecheckResponseSchema.parse({ available: true });
    expect(result.available).toBe(true);
  });
  it('accepts AlreadySubscribed shape', () => {
    const result = premiumCheckoutPrecheckResponseSchema.parse({
      available: false,
      error: 'AlreadySubscribed',
      provider: 'stripe',
      manageUrl: 'https://billing.stripe.com/session/test',
    });
    expect(result.available).toBe(false);
    if (result.available === false && result.error === 'AlreadySubscribed') {
      expect(result.error).toBe('AlreadySubscribed');
      expect(result.provider).toBe('stripe');
    }
  });
  it('rejects missing available field', () => {
    expect(() => premiumCheckoutPrecheckResponseSchema.parse({})).toThrow();
  });
  it('accepts SubscriptionAttemptInFlight shape, no provider/manageUrl required', () => {
    const result = premiumCheckoutPrecheckResponseSchema.parse({
      available: false,
      error: 'SubscriptionAttemptInFlight',
    });
    expect(result.available).toBe(false);
    if (result.available === false) {
      expect(result.error).toBe('SubscriptionAttemptInFlight');
    }
  });
});

describe('premiumBillingPortalResponseSchema', () => {
  it('accepts url', () => {
    const result = premiumBillingPortalResponseSchema.parse({
      url: 'https://billing.stripe.com/session/test',
    });
    expect(result.url).toBe('https://billing.stripe.com/session/test');
  });
});
