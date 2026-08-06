import { describe, expect, it } from 'vitest';

import { fmtBRL, fmtDate, fmtPeriod, fmtRelative } from '../format';

describe('fmtBRL', () => {
  it('formats positive cents as BRL', () => {
    expect(fmtBRL(12345)).toBe('R$ 123,45');
  });

  it('formats negative cents (add-on margin can be negative)', () => {
    const out = fmtBRL(-500);
    expect(out).toContain('5,00');
    expect(out).toContain('-');
    expect(Number(out.replace(/[^\d,-]/g, '').replace(',', '.'))).toBeLessThan(0);
  });

  it('formats zero', () => {
    expect(fmtBRL(0)).toBe('R$ 0,00');
  });
});

describe('fmtDate', () => {
  it('renders "18 ago 2026", not "18/08/2026"', () => {
    expect(fmtDate('2026-08-18T12:00:00.000Z')).toBe('18 ago 2026');
  });

  it('strips the trailing period pt-BR adds to the abbreviated month', () => {
    const out = fmtDate('2026-08-18T12:00:00.000Z');
    expect(out).not.toContain('.');
  });
});

describe('fmtRelative', () => {
  const now = new Date(2026, 7, 18); // 18 ago 2026, local midnight

  it('returns "hoje" for the same day', () => {
    expect(fmtRelative(new Date(2026, 7, 18, 9).toISOString(), now)).toBe('hoje');
  });

  it('returns "amanhã" for the next day', () => {
    expect(fmtRelative(new Date(2026, 7, 19).toISOString(), now)).toBe('amanhã');
  });

  it('returns "ontem" for the previous day', () => {
    expect(fmtRelative(new Date(2026, 7, 17).toISOString(), now)).toBe('ontem');
  });

  it('returns a future day count under 30 days', () => {
    expect(fmtRelative(new Date(2026, 7, 30).toISOString(), now)).toBe('em 12 dias');
  });

  it('returns a past month count under a year', () => {
    expect(fmtRelative(new Date(2026, 4, 18).toISOString(), now)).toBe('há 3 meses');
  });

  it('returns a future month count under a year', () => {
    expect(fmtRelative(new Date(2026, 10, 18).toISOString(), now)).toBe('em 3 meses');
  });

  it('returns a past year count for spans of a year or more', () => {
    expect(fmtRelative(new Date(2023, 7, 18).toISOString(), now)).toBe('há 3 anos');
  });
});

describe('fmtPeriod', () => {
  it('drops the repeated year when both ends share it', () => {
    expect(fmtPeriod('2026-07-19T12:00:00.000Z', '2026-08-18T12:00:00.000Z')).toBe(
      '19 jul – 18 ago 2026',
    );
  });

  it('keeps both years when the period spans a year boundary', () => {
    expect(fmtPeriod('2025-12-19T12:00:00.000Z', '2026-01-18T12:00:00.000Z')).toBe(
      '19 dez 2025 – 18 jan 2026',
    );
  });
});
