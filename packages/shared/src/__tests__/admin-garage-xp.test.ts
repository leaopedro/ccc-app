import { describe, expect, it } from 'vitest';

import { adminXpAdjustmentSchema } from '../admin-garage-xp.js';

describe('adminXpAdjustmentSchema (§C7)', () => {
  it('accepts valid positive delta + 3+ char reason', () => {
    expect(adminXpAdjustmentSchema.parse({ delta: 50, reason: 'Apology bonus' })).toEqual({
      delta: 50,
      reason: 'Apology bonus',
    });
  });

  it('accepts negative delta (§C8)', () => {
    const parsed = adminXpAdjustmentSchema.parse({ delta: -25, reason: 'Reversal of fraud' });
    expect(parsed.delta).toBe(-25);
    expect(parsed.reason).toBe('Reversal of fraud');
  });

  it('rejects delta = 0', () => {
    expect(() => adminXpAdjustmentSchema.parse({ delta: 0, reason: 'noop' })).toThrow();
  });

  it('rejects non-integer delta', () => {
    expect(() => adminXpAdjustmentSchema.parse({ delta: 1.5, reason: 'fractional' })).toThrow();
  });

  it('rejects delta < -10000', () => {
    expect(() => adminXpAdjustmentSchema.parse({ delta: -10_001, reason: 'too much' })).toThrow();
  });

  it('rejects delta > 10000', () => {
    expect(() => adminXpAdjustmentSchema.parse({ delta: 10_001, reason: 'too much' })).toThrow();
  });

  it('rejects reason < 3 chars after trim', () => {
    expect(() => adminXpAdjustmentSchema.parse({ delta: 5, reason: '  a  ' })).toThrow();
  });

  it('rejects reason > 120 chars', () => {
    expect(() => adminXpAdjustmentSchema.parse({ delta: 5, reason: 'a'.repeat(121) })).toThrow();
  });

  it('trims whitespace from reason', () => {
    const parsed = adminXpAdjustmentSchema.parse({ delta: 10, reason: '   trimmed   ' });
    expect(parsed.reason).toBe('trimmed');
  });
});
