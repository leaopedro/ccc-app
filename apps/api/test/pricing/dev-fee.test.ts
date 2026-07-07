import { describe, expect, it } from 'vitest';

import {
  applyDevFee,
  applyDevFeeToLines,
  displayPriceCents,
  getDevFeePercent,
} from '../../src/services/pricing/dev-fee.js';

describe('dev-fee helper', () => {
  it('reads DEV_FEE_PERCENT from env', () => {
    expect(getDevFeePercent({ DEV_FEE_PERCENT: 10 })).toBe(10);
    expect(getDevFeePercent({ DEV_FEE_PERCENT: 25 })).toBe(25);
  });

  it('applies default 10% to a base amount', () => {
    expect(applyDevFee(1000, 10)).toEqual({
      baseAmountCents: 1000,
      devFeePercent: 10,
      devFeeAmountCents: 100,
      grossAmountCents: 1100,
    });
  });

  it('rounds half away from zero per math.round on the fee', () => {
    expect(applyDevFee(999, 10).devFeeAmountCents).toBe(100);
    expect(applyDevFee(123, 10).devFeeAmountCents).toBe(12);
  });

  it('returns 0 fee for zero base or zero percent', () => {
    expect(applyDevFee(0, 10)).toEqual({
      baseAmountCents: 0,
      devFeePercent: 10,
      devFeeAmountCents: 0,
      grossAmountCents: 0,
    });
    expect(applyDevFee(500, 0)).toEqual({
      baseAmountCents: 500,
      devFeePercent: 0,
      devFeeAmountCents: 0,
      grossAmountCents: 500,
    });
  });

  it('rounds per line then sums', () => {
    const result = applyDevFeeToLines(
      [{ baseAmountCents: 333 }, { baseAmountCents: 333 }, { baseAmountCents: 333 }],
      10,
    );
    expect(result.lines.map((l) => l.devFeeAmountCents)).toEqual([33, 33, 33]);
    expect(result.devFeeAmountCents).toBe(99);
    expect(result.baseAmountCents).toBe(999);
    expect(result.grossAmountCents).toBe(1098);
    expect(result.devFeePercent).toBe(10);
  });

  it('preserves arbitrary metadata on lines', () => {
    const result = applyDevFeeToLines(
      [
        { id: 'a', baseAmountCents: 1000 },
        { id: 'b', baseAmountCents: 2000 },
      ],
      10,
    );
    expect(result.lines).toEqual([
      { id: 'a', baseAmountCents: 1000, devFeeAmountCents: 100, grossAmountCents: 1100 },
      { id: 'b', baseAmountCents: 2000, devFeeAmountCents: 200, grossAmountCents: 2200 },
    ]);
  });

  it('exposes a display price helper', () => {
    expect(displayPriceCents(1000, 10)).toBe(1100);
    expect(displayPriceCents(1000, 25)).toBe(1250);
    expect(displayPriceCents(0, 10)).toBe(0);
  });
});
