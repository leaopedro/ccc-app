import { describe, expect, it } from 'vitest';

import { maskCpf, maskPhone, unmaskCpf, unmaskPhone } from './masks';

describe('maskCpf', () => {
  it('formats progressively as digits accumulate', () => {
    expect(maskCpf('5')).toBe('5');
    expect(maskCpf('529')).toBe('529');
    expect(maskCpf('5299')).toBe('529.9');
    expect(maskCpf('529982')).toBe('529.982');
    expect(maskCpf('5299822')).toBe('529.982.2');
    expect(maskCpf('529982247')).toBe('529.982.247');
    expect(maskCpf('52998224725')).toBe('529.982.247-25');
  });

  it('caps at 11 digits and ignores extra input', () => {
    expect(maskCpf('529982247259999')).toBe('529.982.247-25');
  });

  it('strips a mask already present in the input', () => {
    expect(maskCpf('529.982.247-25')).toBe('529.982.247-25');
  });

  it('returns empty string for empty or non-digit input', () => {
    expect(maskCpf('')).toBe('');
    expect(maskCpf('abc')).toBe('');
  });
});

describe('unmaskCpf', () => {
  it('strips non-digit characters', () => {
    expect(unmaskCpf('529.982.247-25')).toBe('52998224725');
  });

  it('caps at 11 digits', () => {
    expect(unmaskCpf('529982247259999')).toBe('52998224725');
  });

  it('never throws on garbage input', () => {
    expect(unmaskCpf('')).toBe('');
    expect(unmaskCpf('abcabc')).toBe('');
  });
});

describe('maskPhone', () => {
  it('formats progressively for a mobile number (11 digits)', () => {
    expect(maskPhone('1')).toBe('(1');
    expect(maskPhone('11')).toBe('(11)');
    expect(maskPhone('119')).toBe('(11) 9');
    expect(maskPhone('11987')).toBe('(11) 987');
    expect(maskPhone('1198765')).toBe('(11) 9876-5');
    expect(maskPhone('119876543')).toBe('(11) 9876-543');
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('formats a landline number (10 digits) with a 4-digit block', () => {
    expect(maskPhone('1132654321')).toBe('(11) 3265-4321');
  });

  it('caps at 11 digits', () => {
    expect(maskPhone('119876543219999')).toBe('(11) 98765-4321');
  });

  it('returns empty string for empty or non-digit input', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('abc')).toBe('');
  });
});

describe('unmaskPhone', () => {
  it('strips non-digit characters', () => {
    expect(unmaskPhone('(11) 98765-4321')).toBe('11987654321');
  });

  it('caps at 11 digits', () => {
    expect(unmaskPhone('(11) 98765-4321999')).toBe('11987654321');
  });

  it('never throws on garbage input', () => {
    expect(unmaskPhone('')).toBe('');
    expect(unmaskPhone('abcabc')).toBe('');
  });
});
