import { describe, expect, it } from 'vitest';

import { adminTicketTierSchema, adminTierCreateSchema, adminTierUpdateSchema } from '../admin.js';

const capacityDisplayFixture = {
  status: 'available',
  mode: 'absolute',
  showAbsolute: true,
  showPercentage: false,
  remaining: 100,
  remainingPercent: 100,
  thresholdPercent: 15,
} as const;

describe('adminTicketTierSchema isPremiumGrantable', () => {
  it('accepts isPremiumGrantable=true on a full tier shape', () => {
    const raw = {
      id: 't_1',
      name: 'Geral',
      priceCents: 5000,
      displayPriceCents: 5500,
      devFeePercent: 10,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      remainingCapacity: 100,
      salesOpenAt: null,
      salesCloseAt: null,
      sortOrder: 0,
      requiresCar: false,
      isPremiumGrantable: true,
      capacityDisplay: capacityDisplayFixture,
    };
    expect(adminTicketTierSchema.parse(raw).isPremiumGrantable).toBe(true);
  });

  it('accepts isPremiumGrantable=false on a full tier shape', () => {
    const raw = {
      id: 't_1',
      name: 'Geral',
      priceCents: 5000,
      displayPriceCents: 5500,
      devFeePercent: 10,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      remainingCapacity: 100,
      salesOpenAt: null,
      salesCloseAt: null,
      sortOrder: 0,
      requiresCar: false,
      isPremiumGrantable: false,
      capacityDisplay: capacityDisplayFixture,
    };
    expect(adminTicketTierSchema.parse(raw).isPremiumGrantable).toBe(false);
  });

  // The output schema requires the field — the API always emits it from the
  // DB column (which has `@default(false)` from F8.01). Using a plain
  // `z.boolean()` instead of `.default(false)` keeps the inferred output type
  // a plain `boolean`, preserving prop-type identity for React consumers.
  it('rejects omission of isPremiumGrantable (API always emits it)', () => {
    const raw = {
      id: 't_1',
      name: 'Geral',
      priceCents: 5000,
      displayPriceCents: 5500,
      devFeePercent: 10,
      currency: 'BRL',
      quantityTotal: 100,
      quantitySold: 0,
      remainingCapacity: 100,
      salesOpenAt: null,
      salesCloseAt: null,
      sortOrder: 0,
      requiresCar: false,
      capacityDisplay: capacityDisplayFixture,
    };
    expect(() => adminTicketTierSchema.parse(raw)).toThrow();
  });
});

describe('adminTierCreateSchema isPremiumGrantable', () => {
  const base = { name: 'Geral', priceCents: 5000, quantityTotal: 100 };

  it('accepts isPremiumGrantable=true', () => {
    expect(
      adminTierCreateSchema.parse({ ...base, isPremiumGrantable: true }).isPremiumGrantable,
    ).toBe(true);
  });

  it('defaults to false when omitted', () => {
    expect(adminTierCreateSchema.parse(base).isPremiumGrantable).toBe(false);
  });
});

describe('adminTierUpdateSchema isPremiumGrantable', () => {
  it('accepts isPremiumGrantable in a partial update', () => {
    expect(adminTierUpdateSchema.parse({ isPremiumGrantable: false }).isPremiumGrantable).toBe(
      false,
    );
  });

  it('passes through when not present (partial — undefined)', () => {
    const result = adminTierUpdateSchema.parse({ name: 'X' });
    expect(result.isPremiumGrantable).toBeUndefined();
  });
});
