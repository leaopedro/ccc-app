import { describe, expect, it } from 'vitest';
import { formatBRL, formatCountdown, isUrgent } from './format';

describe('formatBRL', () => {
  it('formats cents as R$ with pt-BR separators', () => {
    expect(formatBRL(45000)).toBe('R$ 450,00');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(7000)).toBe('R$ 70,00');
  });
});

describe('formatCountdown', () => {
  it('renders days/hours/minutes above 24h', () => {
    const ms = ((6 * 24 + 4) * 60 + 12) * 60 * 1000;
    expect(formatCountdown(ms)).toBe('6d 04h 12m');
  });
  it('drops days under 24h', () => {
    const ms = (4 * 60 + 12) * 60 * 1000;
    expect(formatCountdown(ms)).toBe('04h 12m');
  });
  it('clamps negatives to zero', () => {
    expect(formatCountdown(-5000)).toBe('00h 00m');
  });
});

describe('isUrgent', () => {
  it('is true within the last 24h', () => {
    expect(isUrgent(23 * 60 * 60 * 1000)).toBe(true);
    expect(isUrgent(25 * 60 * 60 * 1000)).toBe(false);
  });
});
