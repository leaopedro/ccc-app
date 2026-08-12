import { describe, expect, it } from 'vitest';
import {
  homeVariant,
  budgetMeter,
  hasDroppedLines,
  cycleMonthLabel,
  cycleMonthYearLabel,
  canUnskip,
  boxStatusLabel,
} from './box-state';

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

describe('cycleMonthLabel', () => {
  it('formats a cycleKey date as a pt-BR month name', () => {
    expect(cycleMonthLabel('2026-08-01')).toBe('agosto');
    expect(cycleMonthLabel('2026-01-01')).toBe('janeiro');
    expect(cycleMonthLabel('2026-12-01')).toBe('dezembro');
  });
});

describe('cycleMonthYearLabel', () => {
  it('formats a cycleKey date as a pt-BR month + year label', () => {
    expect(cycleMonthYearLabel('2026-08-01')).toBe('agosto de 2026');
    expect(cycleMonthYearLabel('2025-08-01')).toBe('agosto de 2025');
    expect(cycleMonthYearLabel('2026-01-01')).toBe('janeiro de 2026');
  });
});

describe('canUnskip', () => {
  it('is true when the cutoff is still in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(canUnskip(future)).toBe(true);
  });

  it('is false when the cutoff has already passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(canUnskip(past)).toBe(false);
  });
});

describe('boxStatusLabel', () => {
  it('maps each status to a PT-BR label', () => {
    expect(boxStatusLabel('open')).toBe('Em montagem');
    expect(boxStatusLabel('awaiting_payment')).toBe('Aguardando pagamento');
    expect(boxStatusLabel('ready')).toBe('Confirmada');
    expect(boxStatusLabel('skipped')).toBe('Pulada');
    expect(boxStatusLabel('cancelled')).toBe('Cancelada');
  });
});
