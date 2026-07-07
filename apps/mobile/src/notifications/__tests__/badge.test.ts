import { describe, expect, it } from 'vitest';

const formatBadge = (count: number): string => (count > 99 ? '99+' : String(count));

describe('badge count formatting', () => {
  it('shows exact count for small values', () => {
    expect(formatBadge(1)).toBe('1');
    expect(formatBadge(9)).toBe('9');
    expect(formatBadge(99)).toBe('99');
  });

  it('caps at 99+ for large values', () => {
    expect(formatBadge(100)).toBe('99+');
    expect(formatBadge(999)).toBe('99+');
  });
});
