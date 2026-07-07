import { describe, expect, it } from 'vitest';

import { buildGarageSlots } from '../garage-slots';

import {
  garageReadFixtureAllFilled,
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureFreeLimitZero,
  garageReadFixtureMixed,
  garageReadFixtureUnlimited,
  garageReadFixtureUnlimitedAllFilled,
} from './fixtures';

describe('buildGarageSlots', () => {
  it('first-run free yields a single empty default_free slot, no buy card', () => {
    const slots = buildGarageSlots(garageReadFixtureEmptyFirstRun);
    expect(slots.map((s) => s.kind)).toEqual(['empty']);
    expect(slots.map((s) => (s.kind === 'empty' ? s.source : null))).toEqual(['default_free']);
  });

  it('freeLimit=0 yields only the buy card', () => {
    const slots = buildGarageSlots(garageReadFixtureFreeLimitZero);
    expect(slots.map((s) => s.kind)).toEqual(['buy']);
  });

  it('mixed yields filled + empty (purchase source), no buy card while a slot is still free', () => {
    const slots = buildGarageSlots(garageReadFixtureMixed);
    expect(slots.map((s) => s.kind)).toEqual(['filled', 'empty']);
    const empties = slots.filter((s) => s.kind === 'empty');
    expect(empties[0]?.kind === 'empty' && empties[0].source).toBe('purchase');
  });

  it('all filled with availableSlots=0 appends the buy card last', () => {
    const slots = buildGarageSlots(garageReadFixtureAllFilled);
    expect(slots.map((s) => s.kind)).toEqual(['filled', 'filled', 'buy']);
  });

  it('unlimited with no spots emits a lazy empty (spot:null) placeholder', () => {
    const slots = buildGarageSlots(garageReadFixtureUnlimited);
    expect(slots.map((s) => s.kind)).toEqual(['empty']);
    expect(slots[0]?.kind === 'empty' && slots[0].spot).toBeNull();
    expect(slots[0]?.kind === 'empty' && slots[0].source).toBe('default_free');
  });

  it('unlimited with an empty materialized spot renders it, no lazy add', () => {
    const slots = buildGarageSlots({
      ...garageReadFixtureUnlimited,
      spots: [
        {
          id: 'sp_pm',
          source: 'premium_membership',
          carId: null,
          createdAt: '2026-05-20T12:00:00.000Z',
        },
      ],
      availableSlots: 1,
    });
    expect(slots.map((s) => s.kind)).toEqual(['empty']);
    expect(slots[0]?.kind === 'empty' && slots[0].source).toBe('premium_membership');
    expect(slots[0]?.kind === 'empty' && slots[0].spot?.id).toBe('sp_pm');
  });

  it('unlimited with one filled + zero empty spots appends a lazy empty add', () => {
    const slots = buildGarageSlots(garageReadFixtureUnlimitedAllFilled);
    expect(slots.map((s) => s.kind)).toEqual(['filled', 'empty']);
    const last = slots[1];
    expect(last?.kind === 'empty' && last.spot).toBeNull();
  });

  it('orphan spot.carId is skipped, no crash', () => {
    const slots = buildGarageSlots({
      ...garageReadFixtureMixed,
      cars: [],
    });
    expect(slots.every((s) => s.kind !== 'filled')).toBe(true);
  });

  it('admin_grant and premium_membership empties preserve their source', () => {
    const slots = buildGarageSlots({
      ...garageReadFixtureMixed,
      cars: [],
      spots: [
        { id: 'sp_g', source: 'admin_grant', carId: null, createdAt: '2026-05-20T12:00:00.000Z' },
        {
          id: 'sp_m',
          source: 'premium_membership',
          carId: null,
          createdAt: '2026-05-20T12:00:00.000Z',
        },
      ],
      availableSlots: 2,
    });
    expect(slots.map((s) => s.kind)).toEqual(['empty', 'empty']);
    expect(slots.map((s) => (s.kind === 'empty' ? s.source : null))).toEqual([
      'admin_grant',
      'premium_membership',
    ]);
  });

  it('omits buy card when purchaseOption is absent even with no available slots', () => {
    const { purchaseOption: _omit, ...rest } = garageReadFixtureAllFilled;
    void _omit;
    const slots = buildGarageSlots(rest);
    expect(slots.map((s) => s.kind)).toEqual(['filled', 'filled']);
  });

  it('assigns a 1-based index in iteration order', () => {
    const slots = buildGarageSlots(garageReadFixtureAllFilled);
    expect(slots.map((s) => s.index)).toEqual([1, 2, 3]);
  });
});
