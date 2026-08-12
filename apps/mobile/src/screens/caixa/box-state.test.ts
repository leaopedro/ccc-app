import { describe, expect, it } from 'vitest';
import { homeVariant, budgetMeter, hasDroppedLines } from './box-state';

describe('homeVariant', () => {
  it('maps each status', () => {
    expect(homeVariant('open')).toBe('open');
    expect(homeVariant('awaiting_payment')).toBe('awaiting_payment');
    expect(homeVariant('ready')).toBe('ready');
    expect(homeVariant('skipped')).toBe('skipped');
    expect(homeVariant('cancelled')).toBe('skipped');
  });
});

describe('budgetMeter', () => {
  it('splits included vs overflow', () => {
    const m = budgetMeter({
      itemsTotalCents: 52000,
      budgetCents: 45000,
      overflowCents: 7000,
    } as never);
    expect(m.includedCents).toBe(45000);
    expect(m.overflowCents).toBe(7000);
    expect(m.fillRatio).toBe(1);
    expect(m.overflowRatio).toBeCloseTo(7000 / 45000);
  });
  it('is partial under budget', () => {
    const m = budgetMeter({
      itemsTotalCents: 34000,
      budgetCents: 45000,
      overflowCents: 0,
    } as never);
    expect(m.includedCents).toBe(34000);
    expect(m.fillRatio).toBeCloseTo(34000 / 45000);
    expect(m.overflowRatio).toBe(0);
  });
  it('handles zero budget', () => {
    const m = budgetMeter({
      itemsTotalCents: 10000,
      budgetCents: 0,
      overflowCents: 10000,
    } as never);
    expect(m.includedCents).toBe(0);
    expect(m.fillRatio).toBe(0);
    expect(m.overflowRatio).toBe(0);
  });
});

describe('hasDroppedLines', () => {
  it('is true when any item line is excluded', () => {
    expect(hasDroppedLines({ items: [{ included: false }], partnerItems: [] } as never)).toBe(true);
    expect(hasDroppedLines({ items: [{ included: true }], partnerItems: [] } as never)).toBe(false);
  });
  it('is true when any partnerItem line is excluded', () => {
    expect(hasDroppedLines({ items: [], partnerItems: [{ included: false }] } as never)).toBe(true);
    expect(hasDroppedLines({ items: [], partnerItems: [{ included: true }] } as never)).toBe(false);
  });
  it('is false when all lines are included', () => {
    expect(
      hasDroppedLines({
        items: [{ included: true }, { included: true }],
        partnerItems: [{ included: true }],
      } as never),
    ).toBe(false);
  });
});
