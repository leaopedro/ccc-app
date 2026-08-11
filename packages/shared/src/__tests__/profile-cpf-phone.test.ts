import { describe, expect, it } from 'vitest';

import { cpfSchema, phoneSchema, publicProfileSchema, updateProfileSchema } from '../profile.js';

describe('cpfSchema', () => {
  it('accepts a valid CPF and strips the mask', () => {
    expect(cpfSchema.parse('529.982.247-25')).toBe('52998224725');
  });

  it('accepts a valid CPF already unmasked', () => {
    expect(cpfSchema.parse('52998224725')).toBe('52998224725');
  });

  it('rejects a CPF whose check digits are wrong', () => {
    expect(cpfSchema.safeParse('529.982.247-26').success).toBe(false);
  });

  it('rejects a CPF whose first check digit is wrong', () => {
    expect(cpfSchema.safeParse('52998224735').success).toBe(false);
  });

  it('rejects repeated-digit sequences that pass the arithmetic', () => {
    expect(cpfSchema.safeParse('11111111111').success).toBe(false);
    expect(cpfSchema.safeParse('00000000000').success).toBe(false);
  });

  it('rejects the wrong number of digits', () => {
    expect(cpfSchema.safeParse('5299822472').success).toBe(false);
    expect(cpfSchema.safeParse('529982247250').success).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('accepts an 11-digit mobile and strips the mask', () => {
    expect(phoneSchema.parse('(11) 98765-4321')).toBe('11987654321');
  });

  it('accepts a 10-digit landline', () => {
    expect(phoneSchema.parse('1132654321')).toBe('1132654321');
  });

  it('rejects a DDD starting with zero', () => {
    expect(phoneSchema.safeParse('01987654321').success).toBe(false);
  });

  it('rejects too few and too many digits', () => {
    expect(phoneSchema.safeParse('119876543').success).toBe(false);
    expect(phoneSchema.safeParse('119876543210').success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts cpf and phone as partials', () => {
    expect(updateProfileSchema.parse({ cpf: '529.982.247-25' })).toEqual({ cpf: '52998224725' });
    expect(updateProfileSchema.parse({ phone: '(11) 98765-4321' })).toEqual({
      phone: '11987654321',
    });
  });

  it('still accepts an empty object', () => {
    expect(updateProfileSchema.parse({})).toEqual({});
  });
});

describe('publicProfileSchema', () => {
  const base = {
    id: 'u1',
    email: 'a@b.test',
    name: 'A',
    role: 'user' as const,
    emailVerifiedAt: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    bio: null,
    city: null,
    stateCode: null,
    avatarUrl: null,
  };

  it('accepts null cpf and phone', () => {
    const parsed = publicProfileSchema.parse({ ...base, cpf: null, phone: null });
    expect(parsed.cpf).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it('accepts digit strings for cpf and phone', () => {
    const parsed = publicProfileSchema.parse({
      ...base,
      cpf: '52998224725',
      phone: '11987654321',
    });
    expect(parsed.cpf).toBe('52998224725');
  });
});
