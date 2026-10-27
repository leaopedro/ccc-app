import { describe, expect, it } from 'vitest';
import {
  homeVariant,
  budgetMeter,
  hasDroppedLines,
  cycleMonthLabel,
  cycleMonthYearLabel,
  canUnskip,
  nextCycleLabel,
  boxStatusLabel,
  boxTimelineSteps,
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

describe('boxTimelineSteps', () => {
  it('labels the three steps in PT-BR with accents', () => {
    const [preparando, enviado, entregue] = boxTimelineSteps('unfulfilled');
    expect(preparando.label).toBe('Preparando');
    expect(enviado.label).toBe('Enviado');
    expect(entregue.label).toBe('Entregue');
  });

  it('maps unfulfilled to current/pending/pending', () => {
    expect(boxTimelineSteps('unfulfilled').map((s) => s.state)).toEqual([
      'current',
      'pending',
      'pending',
    ]);
  });

  it('maps packed to done/current/pending', () => {
    expect(boxTimelineSteps('packed').map((s) => s.state)).toEqual(['done', 'current', 'pending']);
  });

  it('maps shipped to done/done/current', () => {
    expect(boxTimelineSteps('shipped').map((s) => s.state)).toEqual(['done', 'done', 'current']);
  });

  it('maps delivered to all done', () => {
    expect(boxTimelineSteps('delivered').map((s) => s.state)).toEqual(['done', 'done', 'done']);
  });

  it('maps cancelled defensively to the unfulfilled shape', () => {
    expect(boxTimelineSteps('cancelled').map((s) => s.state)).toEqual([
      'current',
      'pending',
      'pending',
    ]);
  });
});

describe('nextCycleLabel', () => {
  const future = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  it('formats the instant the current cycle ends as a pt-BR day + month', () => {
    const formatted = new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
    }).format(new Date(future(3)));
    expect(nextCycleLabel(future(3))).toBe(formatted);
  });

  // A membership whose renewal never landed keeps a cycleEnd in the past. The
  // next box is not open, and no date is better than a date already gone by.
  it('is null once the cycle end is behind us', () => {
    expect(nextCycleLabel('2020-01-03T12:00:00.000Z')).toBeNull();
  });
});
