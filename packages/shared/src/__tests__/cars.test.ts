import { describe, expect, it } from 'vitest';

import { carInputSchema, carUpdateSchema, nicknameRegex } from '../cars.js';

describe('nicknameRegex', () => {
  it('accepts plain ASCII letters and digits', () => {
    expect(nicknameRegex.test('FD3S')).toBe(true);
  });

  it('accepts PT-BR accented letters', () => {
    expect(nicknameRegex.test('Fã do José')).toBe(true);
    expect(nicknameRegex.test('ção')).toBe(true);
    expect(nicknameRegex.test('éàü')).toBe(true);
  });

  it('accepts spaces', () => {
    expect(nicknameRegex.test('RX 7')).toBe(true);
  });

  it('rejects emoji', () => {
    expect(nicknameRegex.test('Fast 🚗')).toBe(false);
  });

  it('rejects punctuation', () => {
    expect(nicknameRegex.test('RX-7')).toBe(false);
    expect(nicknameRegex.test('car@home')).toBe(false);
    expect(nicknameRegex.test('car!')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(nicknameRegex.test('')).toBe(false);
  });
});

describe('carInputSchema', () => {
  const base = { make: 'Mazda', model: 'RX7', year: 1993, nickname: 'FD3S' };

  it('accepts full valid payload', () => {
    const result = carInputSchema.safeParse({
      ...base,
      modifications: ['turbo', 'suspensao'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects nickname with emoji', () => {
    const result = carInputSchema.safeParse({ ...base, nickname: 'Zoom 🚗' });
    expect(result.success).toBe(false);
  });

  it('rejects nickname over 20 chars', () => {
    const result = carInputSchema.safeParse({
      ...base,
      nickname: 'A'.repeat(21),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing nickname (required)', () => {
    const { nickname: _n, ...withoutNick } = base;
    const result = carInputSchema.safeParse(withoutNick);
    expect(result.success).toBe(false);
  });

  it('rejects unknown description field at the schema boundary (silently strips by default)', () => {
    // carInputSchema is not strict() so unknown keys are stripped. The
    // post-pivot contract drops `description` — clients sending it are
    // accepted but the field is silently discarded.
    const result = carInputSchema.safeParse({
      ...base,
      description: 'A'.repeat(151),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).description).toBeUndefined();
    }
  });

  it('rejects modifications array over 20 items', () => {
    const result = carInputSchema.safeParse({
      ...base,
      modifications: Array.from({ length: 21 }, (_, i) => `mod${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('rejects individual modification item over 60 chars', () => {
    const result = carInputSchema.safeParse({
      ...base,
      modifications: ['A'.repeat(61)],
    });
    expect(result.success).toBe(false);
  });

  it('defaults modifications to empty array when omitted', () => {
    const result = carInputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.modifications).toEqual([]);
  });

  it('accepts PT-BR accented nickname', () => {
    const result = carInputSchema.safeParse({ ...base, nickname: 'Chão Batido' });
    expect(result.success).toBe(true);
  });
});

describe('carUpdateSchema', () => {
  it('allows partial update with only nickname', () => {
    const result = carUpdateSchema.safeParse({ nickname: 'Nova' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid nickname in partial update', () => {
    const result = carUpdateSchema.safeParse({ nickname: 'bad!' });
    expect(result.success).toBe(false);
  });
});
