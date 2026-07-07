import { describe, expect, it } from 'vitest';

import { premiumPricingEntrySchema, premiumPricingResponseSchema } from '../premium.js';

const validMonthly = {
  priceId: 'price_monthly_test',
  cadence: 'monthly' as const,
  baseAmountCents: 2990,
  devFeePercent: 10,
  devFeeCents: 299,
  grossAmountCents: 3289,
  currency: 'BRL',
};

const validAnnual = {
  priceId: 'price_annual_test',
  cadence: 'annual' as const,
  baseAmountCents: 29900,
  devFeePercent: 10,
  devFeeCents: 2990,
  grossAmountCents: 32890,
  currency: 'BRL',
};

describe('premiumPricingEntrySchema', () => {
  it('accepts a valid monthly entry', () => {
    expect(premiumPricingEntrySchema.parse(validMonthly)).toEqual(validMonthly);
  });

  it('accepts a valid annual entry', () => {
    expect(premiumPricingEntrySchema.parse(validAnnual)).toEqual(validAnnual);
  });

  it('rejects negative baseAmountCents', () => {
    expect(() =>
      premiumPricingEntrySchema.parse({ ...validMonthly, baseAmountCents: -100 }),
    ).toThrow();
  });

  it('rejects non-integer baseAmountCents', () => {
    expect(() =>
      premiumPricingEntrySchema.parse({ ...validMonthly, baseAmountCents: 29.9 }),
    ).toThrow();
  });

  it('rejects devFeePercent above 100', () => {
    expect(() =>
      premiumPricingEntrySchema.parse({ ...validMonthly, devFeePercent: 150 }),
    ).toThrow();
  });

  it('rejects negative devFeePercent', () => {
    expect(() => premiumPricingEntrySchema.parse({ ...validMonthly, devFeePercent: -1 })).toThrow();
  });

  it('rejects currency with wrong length', () => {
    expect(() => premiumPricingEntrySchema.parse({ ...validMonthly, currency: 'BRLX' })).toThrow();
  });

  it('rejects unknown cadence', () => {
    expect(() => premiumPricingEntrySchema.parse({ ...validMonthly, cadence: 'weekly' })).toThrow();
  });
});

describe('premiumPricingResponseSchema', () => {
  it('accepts both entries together', () => {
    const result = premiumPricingResponseSchema.parse({
      monthly: validMonthly,
      annual: validAnnual,
    });
    expect(result.monthly.cadence).toBe('monthly');
    expect(result.annual.cadence).toBe('annual');
  });

  it('rejects when monthly is missing', () => {
    expect(() => premiumPricingResponseSchema.parse({ annual: validAnnual })).toThrow();
  });

  it('rejects when annual is missing', () => {
    expect(() => premiumPricingResponseSchema.parse({ monthly: validMonthly })).toThrow();
  });
});
