import { describe, expect, it } from 'vitest';

import { editProfileFormSchema } from './edit-profile-form-schema';

const baseValues = {
  name: 'Ana Silva',
  bio: 'Fã de carros clássicos',
  city: 'Curitiba',
  stateCode: 'PR',
  cpf: '',
  phone: '',
};

describe('editProfileFormSchema', () => {
  describe('name', () => {
    it('accepts a non-blank name', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, name: 'Ana' });
      expect(result.success).toBe(true);
    });

    it('rejects a blank name with a PT-BR message, not the Zod default', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Informe seu nome.');
      }
    });
  });

  describe('city', () => {
    it('a blank city does not block the form and normalizes to undefined', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, city: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.city).toBeUndefined();
    });

    it('a filled city passes through', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, city: 'Curitiba' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.city).toBe('Curitiba');
    });
  });

  describe('stateCode', () => {
    it('a blank stateCode does not block the form and normalizes to undefined', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, stateCode: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.stateCode).toBeUndefined();
    });

    it('a valid stateCode passes through', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, stateCode: 'SP' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.stateCode).toBe('SP');
    });

    it('rejects a stateCode outside the enum', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, stateCode: 'XX' });
      expect(result.success).toBe(false);
    });
  });

  describe('cpf', () => {
    it('a blank cpf does not block the form and normalizes to undefined', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, cpf: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.cpf).toBeUndefined();
    });

    it('a valid (masked) cpf passes through', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, cpf: '529.982.247-25' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.cpf).toBe('529.982.247-25');
    });

    it('rejects an invalid cpf with the shared PT-BR message', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, cpf: '111.222.333-44' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('CPF inválido');
      }
    });
  });

  describe('phone', () => {
    it('a blank phone does not block the form and normalizes to undefined', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, phone: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeUndefined();
    });

    it('a valid (masked) phone passes through', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, phone: '(41) 98765-4321' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBe('(41) 98765-4321');
    });

    it('rejects an invalid phone with the shared PT-BR message', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, phone: '(41) 1234' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Telefone inválido');
      }
    });
  });

  describe('bio', () => {
    it('a blank bio stays blank (server accepts "" to clear it)', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, bio: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.bio).toBe('');
    });

    it('a filled bio passes through trimmed', () => {
      const result = editProfileFormSchema.safeParse({ ...baseValues, bio: '  oi  ' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.bio).toBe('oi');
    });
  });

  it('accepts a member with no city and no stateCode saved yet (fresh signup shape)', () => {
    const result = editProfileFormSchema.safeParse({
      name: 'Ana Silva',
      bio: '',
      city: '',
      stateCode: undefined,
      cpf: '',
      phone: '',
    });
    expect(result.success).toBe(true);
  });
});
