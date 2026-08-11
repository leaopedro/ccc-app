import { describe, expect, it } from 'vitest';

import { computeCutoffAt, deriveCycleKey } from '../../../src/services/box/cycle.js';

describe('deriveCycleKey', () => {
  it('formats the period start as YYYY-MM-DD (UTC)', () => {
    expect(deriveCycleKey(new Date('2026-08-01T03:00:00.000Z'))).toBe('2026-08-01');
  });
});

describe('computeCutoffAt', () => {
  it('subtracts N days from the period end', () => {
    const end = new Date('2026-08-31T00:00:00.000Z');
    expect(computeCutoffAt(end, 5).toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });
});
