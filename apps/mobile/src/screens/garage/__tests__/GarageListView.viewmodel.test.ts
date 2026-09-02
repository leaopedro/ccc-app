import { describe, expect, it } from 'vitest';

import { buildGarageSlots, type GarageSlotV2 } from '../garage-slots';

import {
  garageReadFixtureAllFilled,
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureFreeLimitZero,
  garageReadFixtureMixed,
} from './fixtures';

function keyOf(slot: GarageSlotV2): string {
  if (slot.kind === 'filled') return `f-${slot.spot.id}`;
  if (slot.kind === 'empty') return `e-${slot.spot?.id ?? `idx-${slot.index}`}`;
  return `buy-${slot.index}`;
}

// These cases are about keying and ordering, not the iOS gate, so they pass a
// non-iOS platform explicitly (final review I6: `ctx` is required).
const ANDROID = { platform: 'android' };

describe('GarageListView view-model', () => {
  it('keys are unique across all fixtures', () => {
    const fixtures = [
      garageReadFixtureEmptyFirstRun,
      garageReadFixtureFreeLimitZero,
      garageReadFixtureMixed,
      garageReadFixtureAllFilled,
    ];
    for (const f of fixtures) {
      const keys = buildGarageSlots(f, ANDROID).map(keyOf);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('buy card sorts last when present', () => {
    const slots = buildGarageSlots(garageReadFixtureAllFilled, ANDROID);
    expect(slots[slots.length - 1]?.kind).toBe('buy');
    expect(slots.filter((s) => s.kind === 'buy').length).toBe(1);
  });

  it('empty slot preserves the underlying spot id when materialized', () => {
    const slots = buildGarageSlots(garageReadFixtureMixed, ANDROID);
    const empties = slots.filter(
      (s): s is Extract<GarageSlotV2, { kind: 'empty' }> => s.kind === 'empty',
    );
    expect(empties.length).toBeGreaterThan(0);
    for (const s of empties) {
      expect(typeof s.spot?.id).toBe('string');
      expect((s.spot?.id ?? '').length).toBeGreaterThan(0);
    }
  });

  it('buy card never appears when the helper sees available slots', () => {
    const slots = buildGarageSlots(garageReadFixtureMixed, ANDROID);
    expect(slots.find((s) => s.kind === 'buy')).toBeUndefined();
  });
});
