import { describe, expect, it } from 'vitest';

import { buildUpdateProfilePayload, type EditProfileFormValues } from './edit-profile-payload';

const baseValues: EditProfileFormValues = {
  name: 'Ana Silva',
  bio: 'Fã de carros clássicos',
  city: 'Curitiba',
  stateCode: 'PR',
};

describe('buildUpdateProfilePayload', () => {
  it('masks become digits for cpf and phone', () => {
    const payload = buildUpdateProfilePayload(
      { ...baseValues, cpf: '529.982.247-25', phone: '(41) 98765-4321' },
      false,
    );
    expect(payload.cpf).toBe('52998224725');
    expect(payload.phone).toBe('41987654321');
  });

  it('a blank optional cpf/phone is omitted, never sent as an empty string', () => {
    const payload = buildUpdateProfilePayload({ ...baseValues, cpf: '', phone: '' }, false);
    expect(payload.cpf).toBeUndefined();
    expect(payload.phone).toBeUndefined();
  });

  it('a missing (undefined) cpf/phone stays undefined', () => {
    const payload = buildUpdateProfilePayload({ ...baseValues }, false);
    expect(payload.cpf).toBeUndefined();
    expect(payload.phone).toBeUndefined();
  });

  it('a locked cpf is never included, even if the field still holds a value', () => {
    const payload = buildUpdateProfilePayload(
      { ...baseValues, cpf: '529.982.247-25', phone: '41987654321' },
      true,
    );
    expect(payload).not.toHaveProperty('cpf');
    expect(payload.phone).toBe('41987654321');
  });

  it('passes other fields through unchanged', () => {
    const payload = buildUpdateProfilePayload(baseValues, false);
    expect(payload.name).toBe('Ana Silva');
    expect(payload.bio).toBe('Fã de carros clássicos');
    expect(payload.city).toBe('Curitiba');
    expect(payload.stateCode).toBe('PR');
  });
});
