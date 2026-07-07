import { describe, expect, it } from 'vitest';

import {
  computeCapacityDisplay,
  defaultCapacityDisplaySurfaceSetting,
  generalSettingsSchema,
  generalSettingsUpdateSchema,
} from '../general-settings.js';

describe('computeCapacityDisplay', () => {
  it('returns absolute remaining when mode=absolute', () => {
    const result = computeCapacityDisplay(
      { status: 'available', remaining: 8, total: 10 },
      { mode: 'absolute', thresholdPercent: 15 },
    );
    expect(result).toMatchObject({
      showAbsolute: true,
      showPercentage: false,
      remaining: 8,
    });
  });

  it('shows percent only when remaining <= threshold', () => {
    const below = computeCapacityDisplay(
      { status: 'available', remaining: 1, total: 10 },
      { mode: 'percentage_threshold', thresholdPercent: 15 },
    );
    expect(below).toMatchObject({
      showAbsolute: false,
      showPercentage: true,
      remainingPercent: 10,
    });

    const above = computeCapacityDisplay(
      { status: 'available', remaining: 8, total: 10 },
      { mode: 'percentage_threshold', thresholdPercent: 15 },
    );
    expect(above).toMatchObject({
      showAbsolute: false,
      showPercentage: false,
      remainingPercent: null,
    });
  });

  it('suppresses positive labels when hidden', () => {
    const r = computeCapacityDisplay(
      { status: 'available', remaining: 4, total: 10 },
      { mode: 'hidden', thresholdPercent: 15 },
    );
    expect(r.showAbsolute).toBe(false);
    expect(r.showPercentage).toBe(false);
    expect(r.remaining).toBeNull();
  });

  it('keeps sold_out explicit even in hidden mode', () => {
    const r = computeCapacityDisplay(
      { status: 'sold_out', remaining: 0, total: 10 },
      { mode: 'hidden', thresholdPercent: 15 },
    );
    expect(r.status).toBe('sold_out');
    expect(r.showAbsolute).toBe(false);
    expect(r.showPercentage).toBe(false);
  });

  it('keeps unavailable explicit even in percentage mode', () => {
    const r = computeCapacityDisplay(
      { status: 'unavailable', remaining: null, total: null },
      { mode: 'percentage_threshold', thresholdPercent: 15 },
    );
    expect(r.status).toBe('unavailable');
    expect(r.showAbsolute).toBe(false);
    expect(r.showPercentage).toBe(false);
  });

  it('uses default settings without mutating', () => {
    expect(defaultCapacityDisplaySurfaceSetting).toEqual({
      mode: 'absolute',
      thresholdPercent: 15,
    });
  });
});

describe('generalSettingsUpdateSchema', () => {
  it('rejects empty payload', () => {
    expect(generalSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(generalSettingsUpdateSchema.safeParse({ capacityDisplay: {} }).success).toBe(false);
  });

  it('accepts a single-surface partial update', () => {
    const r = generalSettingsUpdateSchema.safeParse({
      capacityDisplay: { tickets: { mode: 'hidden' } },
    });
    expect(r.success).toBe(true);
  });

  it('accepts threshold-only update', () => {
    const r = generalSettingsUpdateSchema.safeParse({
      capacityDisplay: { extras: { thresholdPercent: 25 } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown surface keys', () => {
    const r = generalSettingsUpdateSchema.safeParse({
      capacityDisplay: { unknown: { mode: 'hidden' } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range threshold', () => {
    const r = generalSettingsUpdateSchema.safeParse({
      capacityDisplay: { products: { thresholdPercent: 150 } },
    });
    expect(r.success).toBe(false);
  });
});

describe('generalSettingsUpdateSchema — defaultFreeGarageSpots', () => {
  it('accepts null as unlimited', () => {
    expect(generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: null })).toEqual({
      defaultFreeGarageSpots: null,
    });
  });

  it('accepts 0', () => {
    expect(generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: 0 })).toEqual({
      defaultFreeGarageSpots: 0,
    });
  });

  it('accepts a positive integer', () => {
    expect(generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: 7 })).toEqual({
      defaultFreeGarageSpots: 7,
    });
  });

  it('rejects negative integers', () => {
    expect(() => generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: -1 })).toThrow();
  });

  it('rejects non-integer numbers', () => {
    expect(() => generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: 2.5 })).toThrow();
  });

  it('rejects strings', () => {
    expect(() => generalSettingsUpdateSchema.parse({ defaultFreeGarageSpots: '3' })).toThrow();
  });

  it('accepts a body that only sets defaultFreeGarageSpots', () => {
    const r = generalSettingsUpdateSchema.safeParse({ defaultFreeGarageSpots: 3 });
    expect(r.success).toBe(true);
  });

  it('accepts a mixed body with capacityDisplay + defaultFreeGarageSpots', () => {
    const r = generalSettingsUpdateSchema.safeParse({
      capacityDisplay: { tickets: { mode: 'hidden' } },
      defaultFreeGarageSpots: 2,
    });
    expect(r.success).toBe(true);
  });

  it('accepts the Postgres Int4 max boundary', () => {
    const r = generalSettingsUpdateSchema.safeParse({ defaultFreeGarageSpots: 2147483647 });
    expect(r.success).toBe(true);
  });

  it('rejects values above the Postgres Int4 max', () => {
    const r = generalSettingsUpdateSchema.safeParse({ defaultFreeGarageSpots: 2147483648 });
    expect(r.success).toBe(false);
  });

  it('rejects very large numbers like 9999999999', () => {
    const r = generalSettingsUpdateSchema.safeParse({ defaultFreeGarageSpots: 9999999999 });
    expect(r.success).toBe(false);
  });
});

describe('generalSettingsSchema — gamificationEnabled', () => {
  const base = {
    id: 'general_default',
    capacityDisplay: {
      tickets: { mode: 'absolute' as const, thresholdPercent: 15 },
      extras: { mode: 'absolute' as const, thresholdPercent: 15 },
      products: { mode: 'absolute' as const, thresholdPercent: 15 },
    },
    defaultFreeGarageSpots: null,
    updatedAt: '2026-05-22T12:00:00.000Z',
  };

  it('parses gamificationEnabled true', () => {
    const parsed = generalSettingsSchema.parse({ ...base, gamificationEnabled: true });
    expect(parsed.gamificationEnabled).toBe(true);
  });

  it('parses gamificationEnabled false', () => {
    const parsed = generalSettingsSchema.parse({ ...base, gamificationEnabled: false });
    expect(parsed.gamificationEnabled).toBe(false);
  });

  it('rejects missing gamificationEnabled', () => {
    expect(() => generalSettingsSchema.parse(base)).toThrow();
  });
});

describe('generalSettingsUpdateSchema — gamificationEnabled', () => {
  it('accepts a single-field gamificationEnabled update', () => {
    const r = generalSettingsUpdateSchema.safeParse({ gamificationEnabled: false });
    expect(r.success).toBe(true);
  });

  it('accepts gamificationEnabled true alongside other fields', () => {
    const r = generalSettingsUpdateSchema.safeParse({
      gamificationEnabled: true,
      defaultFreeGarageSpots: 3,
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-boolean gamificationEnabled', () => {
    const r = generalSettingsUpdateSchema.safeParse({ gamificationEnabled: 'yes' });
    expect(r.success).toBe(false);
  });
});
