import type { CapacityDisplayDescriptor } from '@jdm/shared/general-settings';
import { describe, expect, it } from 'vitest';

import { capacityLabel, isCapacityBlocked } from '../capacity-display';

function makeDescriptor(overrides: Partial<CapacityDisplayDescriptor>): CapacityDisplayDescriptor {
  return {
    status: 'available',
    mode: 'absolute',
    showAbsolute: true,
    showPercentage: false,
    remaining: 10,
    remainingPercent: 80,
    thresholdPercent: 15,
    ...overrides,
  };
}

describe('capacityLabel', () => {
  it('returns "Esgotado" for sold_out', () => {
    expect(
      capacityLabel(makeDescriptor({ status: 'sold_out', showAbsolute: false, remaining: 0 })),
    ).toBe('Esgotado');
  });

  it('returns "Indisponível" for unavailable', () => {
    expect(capacityLabel(makeDescriptor({ status: 'unavailable' }))).toBe('Indisponível');
  });

  it('returns null for hidden mode', () => {
    expect(capacityLabel(makeDescriptor({ mode: 'hidden' }))).toBeNull();
  });

  it('returns count label in absolute mode when showAbsolute', () => {
    expect(
      capacityLabel(makeDescriptor({ mode: 'absolute', showAbsolute: true, remaining: 5 })),
    ).toBe('5 disponíveis');
  });

  it('returns null in absolute mode when showAbsolute false', () => {
    expect(capacityLabel(makeDescriptor({ mode: 'absolute', showAbsolute: false }))).toBeNull();
  });

  it('returns percentage label in percentage_threshold mode when showPercentage', () => {
    expect(
      capacityLabel(
        makeDescriptor({
          mode: 'percentage_threshold',
          showAbsolute: false,
          showPercentage: true,
          remaining: null,
          remainingPercent: 8,
        }),
      ),
    ).toBe('8% disponíveis');
  });

  it('returns null in percentage_threshold mode when showPercentage false (above threshold)', () => {
    expect(
      capacityLabel(
        makeDescriptor({
          mode: 'percentage_threshold',
          showAbsolute: false,
          showPercentage: false,
        }),
      ),
    ).toBeNull();
  });

  it('returns null when remaining is null', () => {
    expect(capacityLabel(makeDescriptor({ showAbsolute: true, remaining: null }))).toBeNull();
  });
});

describe('isCapacityBlocked', () => {
  it('returns false for available', () => {
    expect(isCapacityBlocked(makeDescriptor({ status: 'available' }))).toBe(false);
  });

  it('returns true for sold_out', () => {
    expect(isCapacityBlocked(makeDescriptor({ status: 'sold_out' }))).toBe(true);
  });

  it('returns true for unavailable', () => {
    expect(isCapacityBlocked(makeDescriptor({ status: 'unavailable' }))).toBe(true);
  });
});
